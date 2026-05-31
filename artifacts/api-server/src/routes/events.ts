import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { eventsTable, registrationsTable, eventAssignmentsTable, usersTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { randomUUID } from "crypto";

const router = Router();

function generateRecurringDates(
  startDatetime: Date,
  endDatetime: Date,
  frequency: "daily" | "weekly" | "monthly",
  occurrences: number,
): Array<{ start: Date; end: Date }> {
  const results: Array<{ start: Date; end: Date }> = [];
  const duration = endDatetime.getTime() - startDatetime.getTime();

  for (let i = 0; i < occurrences; i++) {
    const start = new Date(startDatetime);
    if (frequency === "daily") start.setDate(start.getDate() + i);
    else if (frequency === "weekly") start.setDate(start.getDate() + i * 7);
    else if (frequency === "monthly") start.setMonth(start.getMonth() + i);
    results.push({ start, end: new Date(start.getTime() + duration) });
  }
  return results;
}

async function canAccessEvent(eventId: number, req: Request): Promise<boolean> {
  const session = (req as any).session;
  if (!session?.userId) return false;
  const role: string = session.role ?? "";
  if (role === "admin" || role === "event_organizer") return true;
  if (role === "event_captain" || role === "court_leader") {
    const [assignment] = await db
      .select()
      .from(eventAssignmentsTable)
      .where(and(eq(eventAssignmentsTable.userId, Number(session.userId)), eq(eventAssignmentsTable.eventId, eventId)));
    return !!assignment;
  }
  return false;
}

router.get("/summary", async (_req, res) => {
  const now = new Date();
  const allEvents = await db.select().from(eventsTable);
  const totalUpcoming = allEvents.filter((e) => new Date(e.startDatetime) > now && e.status !== "ended").length;
  const openForSignup = allEvents.filter(
    (e) =>
      e.status === "upcoming" &&
      new Date(e.signupStartDatetime) <= now &&
      new Date(e.signupEndDatetime) >= now,
  ).length;
  return res.json({ totalUpcoming, openForSignup, totalEvents: allEvents.length });
});

router.get("/", async (req, res) => {
  const { upcoming, search } = req.query as Record<string, string>;
  let rows = await db.select().from(eventsTable).orderBy(eventsTable.startDatetime);

  if (upcoming === "true") {
    const now = new Date();
    rows = rows.filter((e) => new Date(e.startDatetime) >= now && e.status !== "ended");
  }

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.locationName.toLowerCase().includes(q) ||
        e.locationAddress.toLowerCase().includes(q),
    );
  }

  return res.json(rows);
});

router.post("/", requireAuth, requireRole("admin", "event_organizer"), async (req, res) => {
  const {
    name, description, startDatetime, endDatetime, locationName, locationAddress,
    formatType, ratingTypeRequired, minParticipants, maxParticipants, waitlistEnabled,
    requireApproval, signupStartDatetime, signupEndDatetime, recurrence,
  } = req.body;

  const baseEvent = {
    name, description: description ?? null, locationName, locationAddress,
    formatType, ratingTypeRequired, minParticipants, maxParticipants,
    waitlistEnabled, requireApproval, status: "upcoming" as const,
  };

  if (recurrence && recurrence.frequency && recurrence.occurrences > 1) {
    const seriesId = randomUUID();
    const dates = generateRecurringDates(
      new Date(startDatetime),
      new Date(endDatetime),
      recurrence.frequency,
      recurrence.occurrences,
    );

    const signupDuration =
      new Date(signupEndDatetime).getTime() - new Date(signupStartDatetime).getTime();

    const events = await db
      .insert(eventsTable)
      .values(
        dates.map(({ start, end }) => ({
          ...baseEvent,
          seriesId,
          startDatetime: start,
          endDatetime: end,
          signupStartDatetime: new Date(start.getTime() - (new Date(startDatetime).getTime() - new Date(signupStartDatetime).getTime())),
          signupEndDatetime: new Date(start.getTime() - (new Date(startDatetime).getTime() - new Date(signupEndDatetime).getTime())),
        })),
      )
      .returning();
    return res.status(201).json(events);
  }

  const [event] = await db
    .insert(eventsTable)
    .values({
      ...baseEvent,
      startDatetime: new Date(startDatetime),
      endDatetime: new Date(endDatetime),
      signupStartDatetime: new Date(signupStartDatetime),
      signupEndDatetime: new Date(signupEndDatetime),
    })
    .returning();

  return res.status(201).json([event]);
});

router.get("/:id", async (req, res) => {
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, Number(req.params.id)));
  if (!event) return res.status(404).json({ error: "Event not found" });
  return res.json(event);
});

router.patch("/:id", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req: Request<{ id: string }>, res: Response) => {
  const eventId = Number(req.params.id);
  if (!await canAccessEvent(eventId, req)) {
    return res.status(403).json({ error: "Forbidden: not assigned to this event" });
  }

  const [existing] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
  if (!existing) return res.status(404).json({ error: "Event not found" });

  const updates: any = {};
  const fields = [
    "name", "description", "locationName", "locationAddress", "formatType",
    "ratingTypeRequired", "minParticipants", "maxParticipants", "waitlistEnabled",
    "requireApproval", "status",
  ];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  });
  ["startDatetime", "endDatetime", "signupStartDatetime", "signupEndDatetime"].forEach((f) => {
    if (req.body[f] !== undefined) updates[f] = new Date(req.body[f]);
  });

  const [updated] = await db.update(eventsTable).set(updates).where(eq(eventsTable.id, eventId)).returning();
  return res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req: Request<{ id: string }>, res: Response) => {
  const eventId = Number(req.params.id);
  if (!await canAccessEvent(eventId, req)) {
    return res.status(403).json({ error: "Forbidden: not assigned to this event" });
  }

  const [deleted] = await db.delete(eventsTable).where(eq(eventsTable.id, eventId)).returning();
  if (!deleted) return res.status(404).json({ error: "Event not found" });
  return res.status(204).send();
});

router.post("/:id/clone", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req: Request<{ id: string }>, res: Response) => {
  const eventId = Number(req.params.id);
  if (!await canAccessEvent(eventId, req)) {
    return res.status(403).json({ error: "Forbidden: not assigned to this event" });
  }

  const [source] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
  if (!source) return res.status(404).json({ error: "Source event not found" });

  const { name } = req.body ?? {};
  const { id: _id, createdAt: _c, seriesId: _s, ...rest } = source;
  const [cloned] = await db
    .insert(eventsTable)
    .values({
      ...rest,
      name: name ?? `${source.name} (Copy)`,
      status: "upcoming",
    })
    .returning();
  return res.status(201).json(cloned);
});

router.post("/:id/close", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req: Request<{ id: string }>, res: Response) => {
  const eventId = Number(req.params.id);
  if (!await canAccessEvent(eventId, req)) {
    return res.status(403).json({ error: "Forbidden: not assigned to this event" });
  }

  const [updated] = await db
    .update(eventsTable)
    .set({ status: "closed" })
    .where(eq(eventsTable.id, eventId))
    .returning();
  if (!updated) return res.status(404).json({ error: "Event not found" });
  return res.json(updated);
});

router.get("/:id/roster-summary", async (req, res) => {
  const eventId = Number(req.params.id);
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
  if (!event) return res.status(404).json({ error: "Event not found" });

  const regs = await db.select().from(registrationsTable).where(eq(registrationsTable.eventId, eventId));
  const confirmed = regs.filter((r) => r.status === "confirmed").length;
  const waitlisted = regs.filter((r) => r.status === "waitlisted").length;
  const pendingApproval = regs.filter((r) => r.status === "pending_approval").length;

  return res.json({
    confirmed,
    waitlisted,
    pendingApproval,
    total: confirmed + waitlisted + pendingApproval,
    maxParticipants: event.maxParticipants,
  });
});

router.get("/:id/assignments", requireAuth, requireRole("admin", "event_organizer"), async (req: Request<{ id: string }>, res: Response) => {
  const eventId = Number(req.params.id);
  const assignments = await db
    .select({
      userId: eventAssignmentsTable.userId,
      eventId: eventAssignmentsTable.eventId,
      assignedAt: eventAssignmentsTable.assignedAt,
      userName: usersTable.name,
      userUsername: usersTable.username,
      userRole: usersTable.role,
    })
    .from(eventAssignmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, eventAssignmentsTable.userId))
    .where(eq(eventAssignmentsTable.eventId, eventId));
  return res.json(assignments);
});

router.post("/:id/assignments", requireAuth, requireRole("admin", "event_organizer"), async (req: Request<{ id: string }>, res: Response) => {
  const eventId = Number(req.params.id);
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, Number(userId)));
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.role !== "event_captain" && user.role !== "court_leader") {
    return res.status(400).json({ error: "Only event_captain or court_leader users can be assigned to events" });
  }

  const [assignment] = await db
    .insert(eventAssignmentsTable)
    .values({ userId: Number(userId), eventId })
    .onConflictDoNothing()
    .returning();

  return res.status(201).json(assignment ?? { userId: Number(userId), eventId, note: "already assigned" });
});

router.delete("/:id/assignments/:userId", requireAuth, requireRole("admin", "event_organizer"), async (req: Request<{ id: string; userId: string }>, res: Response) => {
  const eventId = Number(req.params.id);
  const userId = Number(req.params.userId);

  const [deleted] = await db
    .delete(eventAssignmentsTable)
    .where(and(eq(eventAssignmentsTable.eventId, eventId), eq(eventAssignmentsTable.userId, userId)))
    .returning();

  if (!deleted) return res.status(404).json({ error: "Assignment not found" });
  return res.status(204).send();
});

export default router;
