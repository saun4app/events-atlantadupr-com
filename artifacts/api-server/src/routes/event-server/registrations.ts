import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { registrationsTable, eventsTable, membersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { canAccessEvent } from "./events.js";

const router = Router({ mergeParams: true });

type EventParams = { id: string };
type RegParams = { id: string; regId: string };

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

router.post("/", async (req: Request<EventParams>, res: Response) => {
  const eventId = Number(req.params.id);
  const { memberDuprId, partnerDuprId } = req.body;

  if (!memberDuprId) {
    return res.status(400).json({ error: "memberDuprId is required" });
  }

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
  if (!event) return res.status(404).json({ error: "Event not found" });

  if (event.status !== "upcoming") {
    return res.status(400).json({ error: "Event is not open for registration" });
  }

  const now = new Date();
  if (now < event.signupStartDatetime || now > event.signupEndDatetime) {
    return res.status(400).json({ error: "Registration is outside the signup window" });
  }

  const [member] = await db.select().from(membersTable).where(eq(membersTable.duprId, memberDuprId));
  if (!member) return res.status(404).json({ error: "Member not found" });

  if (event.formatType === "fixed_partner") {
    if (!partnerDuprId) {
      return res.status(400).json({ error: "partnerDuprId is required for fixed-partner events" });
    }
    const [partner] = await db.select().from(membersTable).where(eq(membersTable.duprId, partnerDuprId));
    if (!partner) return res.status(404).json({ error: "Partner member not found in member list" });
  }

  const [existingReg] = await db
    .select()
    .from(registrationsTable)
    .where(and(eq(registrationsTable.eventId, eventId), eq(registrationsTable.memberDuprId, memberDuprId)));
  if (existingReg) return res.status(409).json({ error: "Member already registered for this event" });

  const allRegs = await db.select().from(registrationsTable).where(eq(registrationsTable.eventId, eventId));
  const confirmedCount = allRegs.filter((r) => r.status === "confirmed").length;

  let status: "confirmed" | "waitlisted" | "pending_approval" = "confirmed";
  if (event.requireApproval) {
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
    .values({ eventId, memberDuprId, partnerDuprId: partnerDuprId ?? null, status, assignedRating: isNaN(assignedRating as any) ? null : assignedRating })
    .returning();

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

export default router;
