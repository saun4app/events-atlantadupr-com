import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { registrationsTable, membersTable, appSettingsTable, emailSendFailuresTable } from "@workspace/db";
import type { EventFormat } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { canAccessEvent, getNormalizedEvent, parseEventType } from "./events.js";
import { issueCode, peekCode, consumeCode, VERIFICATION_COOLDOWN_SECONDS } from "../../lib/verification.js";
import { sendVerificationEmail, sendFailureAlertEmail } from "../../lib/email.js";
import { logger } from "../../lib/logger.js";
import {
  getClientIp,
  recordAttempt,
  recordSuccess,
  rateLimitErrorResponse,
} from "../../lib/rate-limit.js";

const router = Router({ mergeParams: true });

type EventParams = { eventType: string; id: string };
type RegParams = { eventType: string; id: string; regId: string };

const REQUEST_CODE_CONFIG = {
  maxAttempts: 3,
  windowMs: 60 * 60 * 1000, // 1 hour
  blockMs: 60 * 60 * 1000,  // 1 hour
};

const REGISTRATION_SUBMIT_CONFIG = {
  maxAttempts: 5,
  windowMs: 10 * 60 * 1000, // 10 minutes
  blockMs: 15 * 60 * 1000,  // 15 minutes
};

const STAFF_ROLES = ["admin", "event_organizer", "event_captain", "court_leader"];

function isStaffRequest(req: Request): boolean {
  const role = (req as any).session?.role;
  return typeof role === "string" && STAFF_ROLES.includes(role);
}

// Registrations are referenced by event id plus the format discriminator, since
// ids are independent across the two event tables.
function regScope(eventId: number, eventType: EventFormat) {
  return and(eq(registrationsTable.eventId, eventId), eq(registrationsTable.eventType, eventType));
}

function buildRosterEntry(reg: typeof registrationsTable.$inferSelect, includeAdminFields = false, eventType?: EventFormat) {
  const snap = reg.playerSnapshot as any;
  const partnerSnap = reg.partnerSnapshot as any;
  // Backward compatibility: old DB snapshots use playerName/doubleRating/singleRating; new ones use name/doubles/singles
  const playerName = snap?.name ?? snap?.playerName ?? reg.memberDuprId;
  const doubleRating = snap?.doubles ?? snap?.doubleRating ?? null;
  const singleRating = snap?.singles ?? snap?.singleRating ?? null;
  const selfRating = snap?.selfRating ?? null;
  const email = snap?.email ?? null;
  const phone = snap?.phone ?? null;
  const partnerName = partnerSnap?.partnerName ?? null;
  const partnerDoubles = partnerSnap?.partnerDoubles ?? partnerSnap?.partnerDoubleRating ?? null;
  const partnerSelfRating = partnerSnap?.partnerSelfRating ?? null;
  const myRating = parseFloat(doubleRating ?? "NR");
  const partnerRating = parseFloat(partnerDoubles ?? "NR");
  const teamRating = !isNaN(myRating) && !isNaN(partnerRating) ? ((myRating + partnerRating) / 2).toFixed(2) : null;
  return {
    id: reg.id,
    eventId: reg.eventId,
    eventType: reg.eventType,
    memberDuprId: reg.memberDuprId,
    partnerDuprId: reg.partnerDuprId ?? null,
    status: reg.status,
    eventRole: reg.eventRole ?? null,
    ...(eventType !== "fixed_partner" ? { isNew: reg.isNew === "true" } : {}),
    ...(includeAdminFields ? { assignedRating: reg.assignedRating ?? null } : {}),
    registeredAt: reg.registeredAt,
    approvedAt: reg.approvedAt ?? null,
    approvedBy: reg.approvedBy ?? null,
    cancelledAt: reg.cancelledAt ?? null,
    cancelledBy: reg.cancelledBy ?? null,
    playerName,
    doubleRating,
    singleRating,
    selfRating,
    partnerName,
    partnerDoubleRating: partnerDoubles,
    partnerSelfRating,
    teamRating,
    ...(includeAdminFields ? { playerEmail: email, playerPhone: phone } : {}),
  };
}

async function canIncludeAdminFields(eventId: number, eventType: EventFormat, req: Request): Promise<boolean> {
  const role = (req as any).session?.role;
  if (!role) return false;
  if (role === "admin" || role === "event_organizer") return true;
  if (role === "event_captain" || role === "court_leader") {
    return canAccessEvent(eventId, eventType, req);
  }
  return false;
}

router.get("/", async (req: Request<EventParams>, res: Response) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const eventId = Number(req.params.id);
  const includeAdminFields = await canIncludeAdminFields(eventId, eventType, req);
  const regs = await db.select().from(registrationsTable).where(regScope(eventId, eventType));
  const entries = regs.map((r) => buildRosterEntry(r, includeAdminFields, eventType));
  return res.json(entries);
});

router.post("/request-code", async (req: Request<EventParams>, res: Response) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const eventId = Number(req.params.id);
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const partnerEmail = typeof req.body?.partnerEmail === "string" ? req.body.partnerEmail.trim() : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email address is required" });
  }

  // Rate-limit by IP and by email (prevents email-bombing and abuse)
  const clientIp = getClientIp(req);
  const ipResult = recordAttempt(clientIp, "reg:code:ip", REQUEST_CODE_CONFIG);
  if (ipResult.blocked) {
    return rateLimitErrorResponse(res, ipResult.remainingBlockMs);
  }
  const emailResult = recordAttempt(email.toLowerCase(), "reg:code:email", REQUEST_CODE_CONFIG);
  if (emailResult.blocked) {
    return rateLimitErrorResponse(res, emailResult.remainingBlockMs);
  }

  const event = await getNormalizedEvent(eventType, eventId);
  if (!event) return res.status(404).json({ error: "Event not found" });

  const [settings] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  const contactEmail = settings?.eventContactEmails?.[0];

  // Determine if member is NR (non-rated) and requires self-rating
  const [member] = await db
    .select()
    .from(membersTable)
    .where(sql`lower(${membersTable.email}) = lower(${email})`);
  function isNR(rating: string | null): boolean {
    if (!rating || rating === "NR") return true;
    return isNaN(parseFloat(rating));
  }
  const selfRatingRequired = member ? isNR(member.doubles) : false;

  // For fixed-partner events, preflight the partner's NR status so the client
  // can warn before submission instead of failing late at submit time. When the
  // partner email isn't supplied or isn't a known member, treat it as not NR
  // (the submit handler surfaces "partner not found" separately).
  let partnerSelfRatingRequired = false;
  if (eventType === "fixed_partner" && partnerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partnerEmail)) {
    const [partner] = await db
      .select()
      .from(membersTable)
      .where(sql`lower(${membersTable.email}) = lower(${partnerEmail})`);
    partnerSelfRatingRequired = partner ? isNR(partner.doubles) : false;
  }

  // The "from" address must be on a domain verified in the project's Resend
  // account. The event contact email often lives on a domain the operator does
  // not control (e.g. a Zoho Desk subdomain), so prefer a dedicated verified
  // sender configured via VERIFICATION_EMAIL_FROM and fall back to the contact
  // email only if it is not set.
  const fromEmail = process.env.VERIFICATION_EMAIL_FROM || contactEmail;
  if (!fromEmail) {
    logger.error("Cannot send verification code: no VERIFICATION_EMAIL_FROM or eventContactEmails configured");
    return res.json({ sent: false, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired, partnerSelfRatingRequired });
  }
  // Route replies back to the human contact address when the sender is a
  // dedicated no-reply style verified address.
  const replyTo = contactEmail && contactEmail !== fromEmail ? contactEmail : undefined;

  const code = await issueCode(email);
  if (code === null) {
    return res.json({ sent: true, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired, partnerSelfRatingRequired });
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

    return res.json({ sent: false, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired, partnerSelfRatingRequired });
  }

  return res.json({ sent: true, cooldownSeconds: VERIFICATION_COOLDOWN_SECONDS, selfRatingRequired, partnerSelfRatingRequired });
});

router.post("/", async (req: Request<EventParams>, res: Response) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const eventId = Number(req.params.id);
  const { email, memberDuprId, partnerDuprId, partnerEmail, code, selfRating } = req.body;

  const event = await getNormalizedEvent(eventType, eventId);
  if (!event) return res.status(404).json({ error: "Event not found" });

  if (event.status === "cancelled") {
    return res.status(400).json({ error: "This event has been canceled" });
  }
  const staff = isStaffRequest(req);
  if (!staff && event.status !== "upcoming") {
    return res.status(400).json({ error: "Event is not open for registration" });
  }

  const now = new Date();
  if (!staff && (now < event.signupStartDatetime || now > event.signupEndDatetime)) {
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
  if (!staff) {
    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    // Rate-limit registration submission by IP and by email
    const clientIp = getClientIp(req);
    const ipResult = recordAttempt(clientIp, "reg:submit:ip", REGISTRATION_SUBMIT_CONFIG);
    if (ipResult.blocked) {
      return rateLimitErrorResponse(res, ipResult.remainingBlockMs);
    }
    const emailResult = recordAttempt(email.toLowerCase(), "reg:submit:email", REGISTRATION_SUBMIT_CONFIG);
    if (emailResult.blocked) {
      return rateLimitErrorResponse(res, emailResult.remainingBlockMs);
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

  let resolvedPartnerDuprId: string | null = null;
  let partnerMember: typeof membersTable.$inferSelect | undefined;
  if (event.teamFormat === "fixed_partner") {
    if (partnerEmail) {
      const [partner] = await db
        .select()
        .from(membersTable)
        .where(sql`lower(${membersTable.email}) = lower(${partnerEmail})`);
      if (!partner) return res.status(404).json({ error: "Partner email not found in member list" });
      partnerMember = partner;
      resolvedPartnerDuprId = partner.duprId;
    } else if (partnerDuprId) {
      const [partner] = await db.select().from(membersTable).where(eq(membersTable.duprId, partnerDuprId));
      if (!partner) return res.status(404).json({ error: "Partner member not found in member list" });
      partnerMember = partner;
      resolvedPartnerDuprId = partnerDuprId;
    } else {
      return res.status(400).json({ error: "partnerDuprId or partnerEmail is required for fixed-partner events" });
    }
  }

  // A previously cancelled registration should NOT block a fresh signup — it is
  // reactivated below instead. Only an active (confirmed / waitlisted / pending
  // approval, etc.) registration blocks a duplicate signup. Inspect ALL rows for
  // this member (the table has no uniqueness constraint, so historical data may
  // contain multiple rows): if any is active, reject; otherwise reactivate the
  // most recent cancelled row.
  const memberRegs = await db
    .select()
    .from(registrationsTable)
    .where(and(regScope(eventId, eventType), eq(registrationsTable.memberDuprId, finalMemberDuprId)));
  if (memberRegs.some((r) => r.status !== "cancelled")) {
    return res.status(409).json({ error: "Member already registered for this event" });
  }
  const existingReg = memberRegs.slice().sort((a, b) => b.id - a.id)[0];
  const reactivatingCancelled = !!existingReg;

  const allRegs = await db.select().from(registrationsTable).where(regScope(eventId, eventType));
  const confirmedCount = allRegs.filter((r) => r.status === "confirmed").length;

  function isNR(rating: string | null): boolean {
    if (!rating || rating === "NR") return true;
    return isNaN(parseFloat(rating));
  }

  // Enforce the "Allow NR players" toggle for fixed-partner DUPR events.
  // When NR is not allowed, reject non-rated players (primary or partner).
  // Staff adding participants from the admin console are exempt, consistent
  // with the self-rating exemption below.
  const rc = event.ratingConfig as { nrAllowed?: boolean } | null;
  const nrNotAllowed =
    event.teamFormat === "fixed_partner" && !!rc && typeof rc === "object" && "nrAllowed" in rc && rc.nrAllowed === false;
  if (nrNotAllowed && !staff) {
    if (isNR(member?.doubles ?? null)) {
      return res.status(400).json({ error: "This event does not allow non-rated (NR) players. A DUPR doubles rating is required to register." });
    }
    if (isNR(partnerMember?.doubles ?? null)) {
      return res.status(400).json({ error: "This event does not allow non-rated (NR) players. Your partner needs a DUPR doubles rating to register." });
    }
  }

  // Validate and store self-rating for NR players
  // Staff adding participants from admin console are exempt from self-rating requirement
  if (isNR(member?.doubles ?? null) && !staff) {
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
  }

  let status: "confirmed" | "waitlisted" | "pending_approval" = "confirmed";
  if (event.requireApproval === "all" || (event.requireApproval === "nr_only" && isNR(member?.doubles ?? null))) {
    status = "pending_approval";
  } else if (confirmedCount >= event.maxParticipants) {
    if (!event.waitlistEnabled) {
      return res.status(400).json({ error: "Event is full and waitlist is disabled" });
    }
    status = "waitlisted";
  }

  const assignedRating = member?.doubles ? parseFloat(member.doubles) : null;

  // Capture a self-contained snapshot of the registrant (and partner) at signup
  // time so the registration no longer depends on the member list.
  const snapshotSelfRating =
    isNR(member?.doubles ?? null) && !staff && selfRating ? String(selfRating) : member?.selfRating ?? null;
  const playerSnapshot = {
    name: member?.name ?? finalMemberDuprId,
    doubles: member?.doubles ?? null,
    singles: member?.singles ?? null,
    selfRating: snapshotSelfRating,
    email: member?.email ?? null,
    phone: member?.phone ?? null,
  };
  const partnerSnapshot = resolvedPartnerDuprId
    ? {
        partnerName: partnerMember?.name ?? resolvedPartnerDuprId,
        partnerDoubles: partnerMember?.doubles ?? null,
        partnerSelfRating: partnerMember?.selfRating ?? null,
      }
    : null;

  let reg;
  if (reactivatingCancelled && existingReg) {
    // Reactivate the player's cancelled registration in place: refresh the
    // snapshots, partner, status and assigned rating, stamp a fresh
    // registered-at time, and clear stale cancellation/approval metadata.
    [reg] = await db
      .update(registrationsTable)
      .set({
        partnerDuprId: resolvedPartnerDuprId,
        playerSnapshot,
        partnerSnapshot,
        status,
        assignedRating: isNaN(assignedRating as any) ? null : assignedRating,
        registeredAt: new Date(),
        cancelledAt: null,
        cancelledBy: null,
        approvedAt: null,
        approvedBy: null,
      })
      .where(eq(registrationsTable.id, existingReg.id))
      .returning();
  } else {
    [reg] = await db
      .insert(registrationsTable)
      .values({
        eventId,
        eventType,
        memberDuprId: finalMemberDuprId,
        partnerDuprId: resolvedPartnerDuprId,
        playerSnapshot,
        partnerSnapshot,
        status,
        assignedRating: isNaN(assignedRating as any) ? null : assignedRating,
      })
      .returning();
  }

  if (!staff && email) {
    await consumeCode(email);
  }

  // Clear rate-limit counters on successful registration
  if (!staff && email) {
    const clientIp = getClientIp(req);
    recordSuccess(clientIp, "reg:submit:ip");
    recordSuccess(email.toLowerCase(), "reg:submit:email");
  }

  const entry = buildRosterEntry(reg, false, eventType);
  return res.status(201).json(entry);
});

// Bulk-initialize assignedRating = DUPR for all registrations where assignedRating is null
router.post(
  "/bulk-set-assigned-ratings",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<EventParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);

    const regs = await db
      .select()
      .from(registrationsTable)
      .where(and(regScope(eventId, eventType), sql`${registrationsTable.assignedRating} IS NULL`));

    let updated = 0;
    for (const reg of regs) {
      const snap = reg.playerSnapshot as any;
      const dupr = snap?.doubles ?? snap?.doubleRating;
      if (dupr && dupr !== "NR") {
        const rating = parseFloat(dupr);
        if (!isNaN(rating)) {
          await db
            .update(registrationsTable)
            .set({ assignedRating: rating })
            .where(eq(registrationsTable.id, reg.id));
          updated++;
        }
      }
    }

    return res.json({ updated });
  },
);

router.get("/:regId", async (req: Request<RegParams>, res: Response) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const eventId = Number(req.params.id);
  const [reg] = await db
    .select()
    .from(registrationsTable)
    .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)));
  if (!reg) return res.status(404).json({ error: "Registration not found" });
  return res.json(buildRosterEntry(reg, await canIncludeAdminFields(eventId, eventType, req), eventType));
});

router.patch(
  "/:regId",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<RegParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const [existing] = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)));
    if (!existing) return res.status(404).json({ error: "Registration not found" });

    const updates: any = {};
    if (req.body.status !== undefined) updates.status = req.body.status;

    // Replace the primary player. Accept a new member by email or DUPR ID,
    // verify the member exists and is not already registered for this event,
    // then rebuild the player snapshot and reset the assigned rating to the
    // new member's DUPR.
    if (req.body.memberEmail !== undefined || req.body.memberDuprId !== undefined) {
      let newMember: typeof membersTable.$inferSelect | undefined;
      if (req.body.memberEmail) {
        [newMember] = await db
          .select()
          .from(membersTable)
          .where(sql`lower(${membersTable.email}) = lower(${req.body.memberEmail})`);
        if (!newMember) return res.status(404).json({ error: "No member found with that email address" });
      } else if (req.body.memberDuprId) {
        [newMember] = await db.select().from(membersTable).where(eq(membersTable.duprId, req.body.memberDuprId));
        if (!newMember) return res.status(404).json({ error: "No member found with that DUPR ID" });
      }
      if (newMember && newMember.duprId !== existing.memberDuprId) {
        const [dup] = await db
          .select()
          .from(registrationsTable)
          .where(and(regScope(eventId, eventType), eq(registrationsTable.memberDuprId, newMember.duprId)));
        if (dup) return res.status(409).json({ error: "Member already registered for this event" });
        updates.memberDuprId = newMember.duprId;
        updates.playerSnapshot = {
          name: newMember.name ?? newMember.duprId,
          doubles: newMember.doubles ?? null,
          singles: newMember.singles ?? null,
          selfRating: newMember.selfRating ?? null,
          email: newMember.email ?? null,
          phone: newMember.phone ?? null,
        };
        const ar = newMember.doubles ? parseFloat(newMember.doubles) : null;
        updates.assignedRating = ar !== null && !isNaN(ar) ? ar : null;
      }
    }

    // Replace the partner. Accept a partner by email or DUPR ID; email takes
    // precedence and is resolved to the member's DUPR ID.
    let partnerDuprIdToSet: string | null | undefined;
    if (req.body.partnerEmail) {
      const [partner] = await db
        .select()
        .from(membersTable)
        .where(sql`lower(${membersTable.email}) = lower(${req.body.partnerEmail})`);
      if (!partner) return res.status(404).json({ error: "No partner found with that email address" });
      partnerDuprIdToSet = partner.duprId;
    } else if (req.body.partnerDuprId !== undefined) {
      partnerDuprIdToSet = req.body.partnerDuprId;
    }
    if (partnerDuprIdToSet !== undefined) {
      updates.partnerDuprId = partnerDuprIdToSet;
      if (partnerDuprIdToSet) {
        const [partner] = await db.select().from(membersTable).where(eq(membersTable.duprId, partnerDuprIdToSet));
        if (!partner && req.body.partnerEmail === undefined) {
          return res.status(404).json({ error: "No partner found with that DUPR ID" });
        }
        updates.partnerSnapshot = {
          partnerName: partner?.name ?? partnerDuprIdToSet,
          partnerDoubles: partner?.doubles ?? null,
          partnerSelfRating: partner?.selfRating ?? null,
        };
      } else {
        updates.partnerSnapshot = null;
      }
    }
    if (req.body.eventRole !== undefined) updates.eventRole = req.body.eventRole ?? null;
    if (eventType !== "fixed_partner" && req.body.isNew !== undefined) updates.isNew = req.body.isNew ? "true" : "false";
    if (req.body.assignedRating !== undefined) {
      const ar = req.body.assignedRating;
      updates.assignedRating = ar !== null && isFinite(Number(ar)) ? Number(ar) : null;
    }
    if (req.body.selfRating !== undefined) {
      const sr = req.body.selfRating;
      const baseSnapshot = updates.playerSnapshot ?? existing.playerSnapshot ?? {
        name: existing.memberDuprId,
        doubles: null,
        singles: null,
        selfRating: null,
        email: null,
        phone: null,
      };
      if (sr !== null && sr !== "") {
        const num = parseFloat(sr);
        if (isNaN(num) || num < 2.0 || num > 5.0) {
          return res.status(400).json({ error: "Self-rating must be a number between 2.0 and 5.0." });
        }
        if (!/^\d+(\.\d{1,2})?$/.test(sr)) {
          return res.status(400).json({ error: "Self-rating must have at most 2 decimal places (e.g. 3.50)." });
        }
        // Self-rating lives on the registration snapshot (roster source of truth).
        updates.playerSnapshot = { ...baseSnapshot, selfRating: sr };
      } else {
        // Clear self-rating if null/empty
        updates.playerSnapshot = { ...baseSnapshot, selfRating: null };
      }
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

    let updatedReg = existing;
    if (Object.keys(updates).length > 0) {
      const [updated] = await db
        .update(registrationsTable)
        .set(updates)
        .where(eq(registrationsTable.id, Number(req.params.regId)))
        .returning();
      updatedReg = updated;
    }

    return res.json(buildRosterEntry(updatedReg, true, eventType));
  },
);

router.delete(
  "/:regId",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<RegParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const [deleted] = await db
      .delete(registrationsTable)
      .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Registration not found" });
    return res.status(204).send();
  },
);

router.post(
  "/:regId/approve",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<RegParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const [reg] = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)));
    if (!reg) return res.status(404).json({ error: "Registration not found" });

    const event = await getNormalizedEvent(eventType, eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const allRegs = await db.select().from(registrationsTable).where(regScope(eventId, eventType));
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

    return res.json(buildRosterEntry(updated, true, eventType));
  },
);

router.post(
  "/:regId/reject",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<RegParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const [reg] = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)));
    if (!reg) return res.status(404).json({ error: "Registration not found" });

    const [updated] = await db
      .update(registrationsTable)
      .set({ status: "rejected" })
      .where(eq(registrationsTable.id, Number(req.params.regId)))
      .returning();

    return res.json(buildRosterEntry(updated, true, eventType));
  },
);

router.post(
  "/:regId/promote",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<RegParams>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const [reg] = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.id, Number(req.params.regId)), regScope(eventId, eventType)));
    if (!reg) return res.status(404).json({ error: "Registration not found" });

    const event = await getNormalizedEvent(eventType, eventId);
    const allRegs = await db.select().from(registrationsTable).where(regScope(eventId, eventType));
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

    return res.json(buildRosterEntry(updated, true, eventType));
  },
);

router.post("/cancel", async (req: Request<EventParams>, res: Response) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const eventId = Number(req.params.id);
  const { email, code } = req.body;

  const event = await getNormalizedEvent(eventType, eventId);
  if (!event) return res.status(404).json({ error: "Event not found" });

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "A valid email address is required" });
  }

  const verified = await peekCode(email, typeof code === "string" ? code.trim() : "");
  if (!verified) {
    return res.status(400).json({ error: "Invalid or expired verification code. Please request a new code." });
  }

  // Resolve the registration directly from its snapshot email so cancellation
  // stays decoupled from the members table (members may be cleared/deleted
  // independently without breaking existing registrations).
  const regs = await db
    .select()
    .from(registrationsTable)
    .where(
      and(
        regScope(eventId, eventType),
        sql`lower(${registrationsTable.playerSnapshot} ->> 'email') = lower(${email})`,
      ),
    );
  const reg = regs.find((r) => r.status !== "cancelled") ?? regs[0];
  if (!reg) return res.status(404).json({ error: "Registration not found" });

  if (reg.status === "cancelled") {
    return res.status(400).json({ error: "Registration is already canceled." });
  }

  const [updated] = await db
    .update(registrationsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelledBy: "participant" })
    .where(eq(registrationsTable.id, reg.id))
    .returning();

  await consumeCode(email);

  return res.json(buildRosterEntry(updated, false, eventType));
});

export default router;
