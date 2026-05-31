import { Router } from "express";
import { db } from "@workspace/db";
import { registrationsTable, eventsTable, membersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";

const router = Router({ mergeParams: true });

async function buildRosterEntry(reg: typeof registrationsTable.$inferSelect) {
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
    registeredAt: reg.registeredAt,
    approvedAt: reg.approvedAt ?? null,
    approvedBy: reg.approvedBy ?? null,
    playerName: member?.playerName ?? reg.memberDuprId,
    doubleRating: member?.doubleRating ?? null,
    singleRating: member?.singleRating ?? null,
    selfRating: member?.selfRating ?? null,
    partnerName,
  };
}

router.get("/", async (req, res) => {
  const eventId = Number(req.params.id);
  const regs = await db.select().from(registrationsTable).where(eq(registrationsTable.eventId, eventId));
  const entries = await Promise.all(regs.map(buildRosterEntry));
  return res.json(entries);
});

router.post("/", async (req, res) => {
  const eventId = Number(req.params.id);
  const { memberDuprId, partnerDuprId } = req.body;

  if (!memberDuprId) {
    return res.status(400).json({ error: "memberDuprId is required" });
  }

  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
  if (!event) return res.status(404).json({ error: "Event not found" });

  const now = new Date();
  if (now < new Date(event.signupStartDatetime) || now > new Date(event.signupEndDatetime)) {
    return res.status(400).json({ error: "Signup window is not open" });
  }

  if (event.status !== "upcoming") {
    return res.status(400).json({ error: "Event is not open for registration" });
  }

  const [member] = await db.select().from(membersTable).where(eq(membersTable.duprId, memberDuprId));
  if (!member) return res.status(400).json({ error: "Member not found with that DUPR ID" });

  const existing = await db
    .select()
    .from(registrationsTable)
    .where(and(eq(registrationsTable.eventId, eventId), eq(registrationsTable.memberDuprId, memberDuprId)));
  if (existing.length > 0 && existing[0].status !== "rejected") {
    return res.status(400).json({ error: "Already registered for this event" });
  }

  const allRegs = await db.select().from(registrationsTable).where(eq(registrationsTable.eventId, eventId));
  const confirmedCount = allRegs.filter((r) => r.status === "confirmed").length;
  const isFull = confirmedCount >= event.maxParticipants;

  let status: "confirmed" | "waitlisted" | "pending_approval" = "confirmed";
  if (isFull && event.waitlistEnabled) {
    status = "waitlisted";
  } else if (isFull && !event.waitlistEnabled) {
    return res.status(400).json({ error: "Event is full and waitlist is not enabled" });
  } else if (event.requireApproval) {
    status = "pending_approval";
  }

  const [reg] = await db
    .insert(registrationsTable)
    .values({
      eventId,
      memberDuprId,
      partnerDuprId: partnerDuprId ?? null,
      status,
    })
    .returning();

  const entry = await buildRosterEntry(reg);
  return res.status(201).json(entry);
});

router.get("/:regId", async (req, res) => {
  const [reg] = await db
    .select()
    .from(registrationsTable)
    .where(
      and(eq(registrationsTable.id, Number(req.params.regId)), eq(registrationsTable.eventId, Number(req.params.id))),
    );
  if (!reg) return res.status(404).json({ error: "Registration not found" });
  return res.json(await buildRosterEntry(reg));
});

router.patch("/:regId", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req, res) => {
  const [existing] = await db
    .select()
    .from(registrationsTable)
    .where(
      and(eq(registrationsTable.id, Number(req.params.regId)), eq(registrationsTable.eventId, Number(req.params.id))),
    );
  if (!existing) return res.status(404).json({ error: "Registration not found" });

  const updates: any = {};
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.partnerDuprId !== undefined) updates.partnerDuprId = req.body.partnerDuprId;

  const [updated] = await db
    .update(registrationsTable)
    .set(updates)
    .where(eq(registrationsTable.id, Number(req.params.regId)))
    .returning();

  return res.json(await buildRosterEntry(updated));
});

router.delete("/:regId", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req, res) => {
  const [deleted] = await db
    .delete(registrationsTable)
    .where(
      and(eq(registrationsTable.id, Number(req.params.regId)), eq(registrationsTable.eventId, Number(req.params.id))),
    )
    .returning();
  if (!deleted) return res.status(404).json({ error: "Registration not found" });
  return res.status(204).send();
});

router.post("/:regId/approve", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req, res) => {
  const [reg] = await db
    .select()
    .from(registrationsTable)
    .where(
      and(eq(registrationsTable.id, Number(req.params.regId)), eq(registrationsTable.eventId, Number(req.params.id))),
    );
  if (!reg) return res.status(404).json({ error: "Registration not found" });

  const sessionUserId = (req as any).session?.userId;
  const [updated] = await db
    .update(registrationsTable)
    .set({ status: "confirmed", approvedAt: new Date(), approvedBy: sessionUserId })
    .where(eq(registrationsTable.id, Number(req.params.regId)))
    .returning();

  return res.json(await buildRosterEntry(updated));
});

router.post("/:regId/reject", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req, res) => {
  const [reg] = await db
    .select()
    .from(registrationsTable)
    .where(
      and(eq(registrationsTable.id, Number(req.params.regId)), eq(registrationsTable.eventId, Number(req.params.id))),
    );
  if (!reg) return res.status(404).json({ error: "Registration not found" });

  const [updated] = await db
    .update(registrationsTable)
    .set({ status: "rejected" })
    .where(eq(registrationsTable.id, Number(req.params.regId)))
    .returning();

  return res.json(await buildRosterEntry(updated));
});

router.post("/:regId/promote", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req, res) => {
  const eventId = Number(req.params.id);
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

  return res.json(await buildRosterEntry(updated));
});

export default router;
