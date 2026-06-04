import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { registrationsTable, eventsTable, membersTable, appSettingsTable, emailSendFailuresTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { canAccessEvent } from "./events.js";
import { issueCode, peekCode, consumeCode, VERIFICATION_COOLDOWN_SECONDS } from "../../lib/verification.js";
import { sendVerificationEmail, sendFailureAlertEmail } from "../../lib/email.js";
import { logger } from "../../lib/logger.js";

const router = Router({ mergeParams: true });

type EventParams = { id: string };
type RegParams = { id: string; regId: string };

const STAFF_ROLES = ["admin", "event_organizer", "event_captain", "court_leader"];

function isStaffRequest(req: Request): boolean {
  const role = (req as any).session?.role;
  return typeof role === "string" && STAFF_ROLES.includes(role);
}

async function buildRosterEntry(reg: typeof registrationsTable.$inferSelect, includeAdminFields = false) {
  const [member] = await db.select().from(membersTable).where(eq(membersTable.duprId, reg.memberDuprId));
  let partnerName: string | null = null;
  if (reg.partnerDuprId) {
    const [partner] = await db.select().from(membersTable).where(eq(membersTable.duprId, reg.partnerDuprId));
    partnerName = partner?.playerName ?? null;
  }
  return {
    id: reg.id,
    eventId: reg.eventId,
    memberDuprId: reg.memberDuprId,
    partnerDuprId: reg.partnerDuprId ?? null,
    status: reg.status,
    eventRole: reg.eventRole ?? null,
    isNew: reg.isNew === "true",
    ...(includeAdminFields ? { assignedRating: reg.assignedRating ?? null } : {}),
    registeredAt: reg.registeredAt,
    approvedAt: reg.approvedAt ?? null,
    approvedBy: reg.approvedBy ?? null,
    cancelledAt: reg.cancelledAt ?? null,
    cancelledBy: reg.cancelledBy ?? null,
    playerName: member?.playerName ?? reg.memberDuprId,
    doubleRating: member?.doubleRating ?? null,
    singleRating: member?.singleRating ?? null,
    selfRating: member?.selfRating ?? null,
    partnerName,
    ...(includeAdminFields ? { playerEmail: member?.email ?? null, playerPhone: member?.phone ?? null } : {}),
  };
}

async function canIncludeAdminFields(eventId: number, req: Request): Promise<boolean> {
  const role = (req as any).session?.role;
  if (!role) return false;
  if (role === "admin" || role === "event_organizer") return true;
  if (role === "event_captain" || role === "court_leader") {
    return canAccessEvent(eventId, req);
  }
  return false;
}

router.get("/", async (req: Request<EventParams>, res: Response) => {
  const eventId = Number(req.params.id);
  const includeAdminFields = await canIncludeAdminFields(eventId, req);
  const regs = await db.select().from(registrationsTable).where(eq(registrationsTable.eventId, eventId));
  const entries = await Promise.all(regs.map(r => buildRosterEntry(r, includeAdminFields)));
  return res.json(entries);
});

router.post("/request-code", async (req: Request<EventParams>, res: Response) => {
  const eventId = Number(req.params.id);
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email address is required" });
  }

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
  if (!event) return res.status(404).json({ error: "Event not found" });

  const [settings] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  const contactEmail = settings?.eventContactEmails?.[0];

  // The "from" address must be on a domain verified in the project's Resend
  // account. The event contact email often lives on a domain the operator does
  // not control (e.g. a Zoho Desk subdomain), so prefer a dedicated verified
  // sender configured via VERIFICATION_EMAIL_FROM and fall back to the contact
  // email only if it is not set.
  const fromEmail = process.env.VERIFICATION_EMAIL_FROM || contactEmail;
  if (!fromEmail) {
    logger.error("Cannot send verification code: no VERIFICATION_EMAIL_FROM or eventContactEmails configured");
    return res.json({ sent: false, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired: false });
  }
  // Route replies back to the human contact address when the sender is a
  // dedicated no-reply style verified address.
  const replyTo = contactEmail && contactEmail !== fromEmail ? contactEmail : undefined;

  const code = await issueCode(email);
  if (code === null) {
    return res.json({ sent: true, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired: false });
  }

  try {
    await sendVerificationEmail({ to: email, code, from: fromEmail, replyTo, eventName: event.name });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, recipient: email, event: event.name }, "Failed to send verification email");

    db.insert(emailSendFailuresTable)
      .values({ recipientAddress: email, eventName: event.name, errorMessage })
      .catch((dbErr) => {
        logger.error({ dbErr }, "Failed to persist email send failure record");
      });

    const alertRecipients = settings?.eventContactEmails ?? [];
    if (alertRecipients.length > 0) {
      sendFailureAlertEmail({
        to: alertRecipients,
        from: fromEmail,
        recipientAddress: email,
        eventName: event.name,
        errorMessage,
      }).catch((alertErr) => {
        logger.error({ alertErr }, "Failed to send email failure alert to organizer");
      });
    }

    return res.json({ sent: false, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired: false });
  }

  // Determine if member is NR (non-rated) and requires self-rating
  const [member] = await db
    .select()
    .from(membersTable)
    .where(sql`lower(${membersTable.email}) = lower(${email})`);
  function isNR(rating: string | null): boolean {
    if (!rating || rating === "NR") return true;
    return isNaN(parseFloat(rating));
  }
  const selfRatingRequired = member ? isNR(member.doubleRating) : false;

  return res.json({ sent: true, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired });
});

router.post("/", async (req: Request<EventParams>, res: Response) => {
  const eventId = Number(req.params.id);
  const { email, memberDuprId, partnerDuprId, code, selfRating } = req.body;

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
  if (!event) return res.status(404).json({ error: "Event not found" });

  if (event.status !== "upcoming") {
    return res.status(400).json({ error: "Event is not open for registration" });
  }

  const now = new Date();
  if (now < event.signupStartDatetime || now > event.signupEndDatetime) {
    return res.status(400).json({ error: "Registration is outside the signup window" });
  }

  if (email && memberDuprId) {
    return res.status(400).json({ error: "Provide only email or memberDuprId, not both" });
  }
  if (!email && !memberDuprId) {
    return res.status(400).json({ error: "email or memberDuprId is required" });
  }

  // Public self-registration (email-based, unauthenticated) requires a verified
  // email. Staff adding participants from the admin console are exempt.
  const staff = isStaffRequest(req);
  if (!staff) {
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }
    const verified = await peekCode(email, typeof code === "string" ? code.trim() : "");
    if (!verified) {
      return res.status(400).json({ error: "Invalid or expired verification code. Please request a new code." });
    }
  }

  let member: typeof membersTable.$inferSelect | undefined;
  let resolvedMemberDuprId: string | undefined;
  if (email) {
    [member] = await db
      .select()
      .from(membersTable)
      .where(sql`lower(${membersTable.email}) = lower(${email})`);
    if (!member) return res.status(404).json({ error: "No member found with that email address. Please use the email associated with your DUPR account." });
    resolvedMemberDuprId = member.duprId;
  } else {
    [member] = await db.select().from(membersTable).where(eq(membersTable.duprId, memberDuprId));
    if (!member) return res.status(404).json({ error: "No member found with that DUPR ID" });
    resolvedMemberDuprId = member.duprId;
  }

  const finalMemberDuprId = resolvedMemberDuprId;

  if (event.teamFormat === "fixed_partner") {
    if (!partnerDuprId) {
      return res.status(400).json({ error: "partnerDuprId is required for fixed-partner events" });
    }
    const [partner] = await db.select().from(membersTable).where(eq(membersTable.duprId, partnerDuprId));
    if (!partner) return res.status(404).json({ error: "Partner member not found in member list" });
  }

  const [existingReg] = await db
    .select()
    .from(registrationsTable)
    .where(and(eq(registrationsTable.eventId, eventId), eq(registrationsTable.memberDuprId, finalMemberDuprId)));
  if (existingReg) return res.status(409).json({ error: "Member already registered for this event" });

  const allRegs = await db.select().from(registrationsTable).where(eq(registrationsTable.eventId, eventId));
  const confirmedCount = allRegs.filter((r) => r.status === "confirmed").length;

  function isNR(rating: string | null): boolean {
    if (!rating || rating === "NR") return true;
    return isNaN(parseFloat(rating));
  }

  // Validate and store self-rating for NR players
  if (isNR(member?.doubleRating)) {
    if (!selfRating || typeof selfRating !== "string") {
      return res.status(400).json({ error: "Self-rating is required for NR (non-rated) players. Please enter a rating between 2.0 and 5.0." });
    }
    const num = parseFloat(selfRating);
    if (isNaN(num) || num < 2.0 || num > 5.0) {
      return res.status(400).json({ error: "Self-rating must be a number between 2.0 and 5.0." });
    }
    if (!/^\d+(\.\d{1,2})?$/.test(selfRating)) {
      return res.status(400).json({ error: "Self-rating must have at most 2 decimal places (e.g. 3.50)." });
    }
    // Update member's self-rating
    await db.update(membersTable).set({ selfRating }).where(eq(membersTable.duprId, finalMemberDuprId));
  }

  let status: "confirmed" | "waitlisted" | "pending_approval" = "confirmed";
  if (event.requireApproval === "all" || (event.requireApproval === "nr_only" && isNR(member?.doubleRating))) {
    status = "pending_approval";
  } else if (confirmedCount >= event.maxParticipants) {
    if (!event.waitlistEnabled) {
      return res.status(400).json({ error: "Event is full and waitlist is disabled" });
    }
    status = "waitlisted";
  }

  const assignedRating = member?.doubleRating ? parseFloat(member.doubleRating) : null;

  const [reg] = await db
    .insert(registrationsTable)
    .values({ eventId, memberDuprId: finalMemberDuprId, partnerDuprId: partnerDuprId ?? null, status, assignedRating: isNaN(assignedRating as any) ? null : assignedRating })
    .returning();

  if (!staff && email) {
    await consumeCode(email);
  }

  const entry = await buildRosterEntry(reg, false);
  return res.status(201).json(entry);
});

router.get("/:regId", async (req: Request<RegParams>, res: Response) => {
  const [reg] = await db
    .select()
    .from(registrationsTable)
    .where(
      and(eq(registrationsTable.id, Number(req.params.regId)), eq(registrationsTable.eventId, Number(req.params.id))),
    );
  if (!reg) return res.status(404).json({ error: "Registration not found" });
  return res.json(await buildRosterEntry(reg, await canIncludeAdminFields(Number(req.params.id), req)));
});

router.patch("/:regId", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req: Request<RegParams>, res: Response) => {
  const eventId = Number(req.params.id);
  if (!await canAccessEvent(eventId, req)) {
    return res.status(403).json({ error: "Forbidden: not assigned to this event" });
  }

  const [existing] = await db
    .select()
    .from(registrationsTable)
    .where(
      and(eq(registrationsTable.id, Number(req.params.regId)), eq(registrationsTable.eventId, eventId)),
    );
  if (!existing) return res.status(404).json({ error: "Registration not found" });

  const updates: any = {};
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.partnerDuprId !== undefined) updates.partnerDuprId = req.body.partnerDuprId;
  if (req.body.eventRole !== undefined) updates.eventRole = req.body.eventRole ?? null;
  if (req.body.isNew !== undefined) updates.isNew = req.body.isNew ? "true" : "false";
  if (req.body.assignedRating !== undefined) {
    const ar = req.body.assignedRating;
    updates.assignedRating = ar !== null && isFinite(Number(ar)) ? Number(ar) : null;
  }

  // Server-managed cancellation metadata: when status transitions to cancelled,
  // record the timestamp and the acting staff member. When moving away from
  // cancelled, clear the metadata so the fields stay accurate.
  const newStatus = req.body.status;
  if (newStatus === "cancelled" && existing.status !== "cancelled") {
    updates.cancelledAt = new Date();
    const sessionUser = (req as any).session;
    updates.cancelledBy = sessionUser?.username || sessionUser?.role || "admin";
  } else if (newStatus !== undefined && newStatus !== "cancelled" && existing.status === "cancelled") {
    updates.cancelledAt = null;
    updates.cancelledBy = null;
  }

  const [updated] = await db
    .update(registrationsTable)
    .set(updates)
    .where(eq(registrationsTable.id, Number(req.params.regId)))
    .returning();

  return res.json(await buildRosterEntry(updated, true));
});

router.delete("/:regId", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req: Request<RegParams>, res: Response) => {
  const eventId = Number(req.params.id);
  if (!await canAccessEvent(eventId, req)) {
    return res.status(403).json({ error: "Forbidden: not assigned to this event" });
  }

  const [deleted] = await db
    .delete(registrationsTable)
    .where(
      and(eq(registrationsTable.id, Number(req.params.regId)), eq(registrationsTable.eventId, eventId)),
    )
    .returning();
  if (!deleted) return res.status(404).json({ error: "Registration not found" });
  return res.status(204).send();
});

router.post("/:regId/approve", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req: Request<RegParams>, res: Response) => {
  const eventId = Number(req.params.id);
  if (!await canAccessEvent(eventId, req)) {
    return res.status(403).json({ error: "Forbidden: not assigned to this event" });
  }

  const [reg] = await db
    .select()
    .from(registrationsTable)
    .where(
      and(eq(registrationsTable.id, Number(req.params.regId)), eq(registrationsTable.eventId, eventId)),
    );
  if (!reg) return res.status(404).json({ error: "Registration not found" });

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
  if (!event) return res.status(404).json({ error: "Event not found" });

  const allRegs = await db.select().from(registrationsTable).where(eq(registrationsTable.eventId, eventId));
  const confirmedCount = allRegs.filter((r) => r.status === "confirmed").length;

  let newStatus: "confirmed" | "waitlisted";
  if (confirmedCount >= event.maxParticipants) {
    if (!event.waitlistEnabled) {
      return res.status(400).json({ error: "Event is full and waitlist is disabled; cannot approve" });
    }
    newStatus = "waitlisted";
  } else {
    newStatus = "confirmed";
  }

  const sessionUserId = (req as any).session?.userId;
  const [updated] = await db
    .update(registrationsTable)
    .set({ status: newStatus, approvedAt: new Date(), approvedBy: sessionUserId })
    .where(eq(registrationsTable.id, Number(req.params.regId)))
    .returning();

  return res.json(await buildRosterEntry(updated, true));
});

router.post("/:regId/reject", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req: Request<RegParams>, res: Response) => {
  const eventId = Number(req.params.id);
  if (!await canAccessEvent(eventId, req)) {
    return res.status(403).json({ error: "Forbidden: not assigned to this event" });
  }

  const [reg] = await db
    .select()
    .from(registrationsTable)
    .where(
      and(eq(registrationsTable.id, Number(req.params.regId)), eq(registrationsTable.eventId, eventId)),
    );
  if (!reg) return res.status(404).json({ error: "Registration not found" });

  const [updated] = await db
    .update(registrationsTable)
    .set({ status: "rejected" })
    .where(eq(registrationsTable.id, Number(req.params.regId)))
    .returning();

  return res.json(await buildRosterEntry(updated, true));
});

router.post("/:regId/promote", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req: Request<RegParams>, res: Response) => {
  const eventId = Number(req.params.id);
  if (!await canAccessEvent(eventId, req)) {
    return res.status(403).json({ error: "Forbidden: not assigned to this event" });
  }

  const [reg] = await db
    .select()
    .from(registrationsTable)
    .where(and(eq(registrationsTable.id, Number(req.params.regId)), eq(registrationsTable.eventId, eventId)));
  if (!reg) return res.status(404).json({ error: "Registration not found" });

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
  const allRegs = await db.select().from(registrationsTable).where(eq(registrationsTable.eventId, eventId));
  const confirmedCount = allRegs.filter((r) => r.status === "confirmed").length;

  if (confirmedCount >= (event?.maxParticipants ?? 0)) {
    return res.status(400).json({ error: "Event is still full" });
  }

  const sessionUserId = (req as any).session?.userId;
  const [updated] = await db
    .update(registrationsTable)
    .set({ status: "confirmed", approvedAt: new Date(), approvedBy: sessionUserId })
    .where(eq(registrationsTable.id, Number(req.params.regId)))
    .returning();

  return res.json(await buildRosterEntry(updated, true));
});

router.post("/cancel", async (req: Request<EventParams>, res: Response) => {
  const eventId = Number(req.params.id);
  const { email, code } = req.body;

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
  if (!event) return res.status(404).json({ error: "Event not found" });

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email address is required" });
  }

  const verified = await peekCode(email, typeof code === "string" ? code.trim() : "");
  if (!verified) {
    return res.status(400).json({ error: "Invalid or expired verification code. Please request a new code." });
  }

  const [member] = await db
    .select()
    .from(membersTable)
    .where(sql`lower(${membersTable.email}) = lower(${email})`);
  if (!member) {
    return res.status(404).json({ error: "No member found with that email address." });
  }

  const [reg] = await db
    .select()
    .from(registrationsTable)
    .where(
      and(eq(registrationsTable.eventId, eventId), eq(registrationsTable.memberDuprId, member.duprId)),
    );
  if (!reg) return res.status(404).json({ error: "Registration not found" });

  if (reg.status === "cancelled") {
    return res.status(400).json({ error: "Registration is already cancelled." });
  }

  const [updated] = await db
    .update(registrationsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "participant" })
    .where(eq(registrationsTable.id, reg.id))
    .returning();

  await consumeCode(email);

  return res.json(await buildRosterEntry(updated, false));
});

export default router;
