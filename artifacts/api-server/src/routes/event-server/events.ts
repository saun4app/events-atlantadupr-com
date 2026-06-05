import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { eventsTable, registrationsTable, eventAssignmentsTable, usersTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, requireRole } from "../../lib/auth.js";
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

export async function canAccessEvent(eventId: number, req: Request): Promise<boolean> {
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
    rows = rows.filter((e) => new Date(e.startDatetime) >= now && e.status !== "ended" && e.status !== "closed");
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

  const counts = await db
    .select({ eventId: registrationsTable.eventId, confirmedCount: count() })
    .from(registrationsTable)
    .where(eq(registrationsTable.status, "confirmed"))
    .groupBy(registrationsTable.eventId);
  const countMap = Object.fromEntries(counts.map((c) => [c.eventId, c.confirmedCount]));

  return res.json(rows.map((r) => ({ ...r, confirmedCount: countMap[r.id] ?? 0 })));
});

router.post("/", requireAuth, requireRole("admin", "event_organizer"), async (req, res) => {
  const {
    name, description, eventDescription, startDatetime, endDatetime, locationName, locationAddress,
    teamFormat, ratingTypeRequired, ratingConfig, minParticipants, maxParticipants, waitlistEnabled,
    requireApproval, signupStartDatetime, signupEndDatetime, recurrence,
    courtFeeEnabled, memberFee, nonMemberFee, contactEmail,
  } = req.body;

  const baseEvent = {
    name, description: description ?? null, eventDescription: eventDescription ?? null, locationName, locationAddress,
    teamFormat, ratingTypeRequired, ratingConfig: ratingConfig ?? null,
    minParticipants, maxParticipants,
    waitlistEnabled, requireApproval: requireApproval ?? "none", status: "upcoming" as const,
    courtFeeEnabled: courtFeeEnabled ?? false,
    memberFee: typeof memberFee === "number" ? memberFee : 0,
    nonMemberFee: typeof nonMemberFee === "number" ? nonMemberFee : 0,
    contactEmail: contactEmail ?? null,
  };

  if (recurrence) {
    const seriesId = randomUUID();
    const startMs = new Date(startDatetime).getTime();
    const duration = new Date(endDatetime).getTime() - startMs;
    const signupStartOffset = startMs - new Date(signupStartDatetime).getTime();
    const signupEndOffset = startMs - new Date(signupEndDatetime).getTime();

    let additionalStarts: Date[] = [];

    if (Array.isArray(recurrence.dates) && recurrence.dates.length > 0) {
      additionalStarts = recurrence.dates.map((d: string) => new Date(d));
    } else if (recurrence.frequency && recurrence.occurrences > 1) {
      const allDates = generateRecurringDates(
        new Date(startDatetime),
        new Date(endDatetime),
        recurrence.frequency,
        recurrence.occurrences,
      );
      additionalStarts = allDates.slice(1).map(({ start }) => start);
    }

    const allStarts = [new Date(startDatetime), ...additionalStarts];

    const events = await db
      .insert(eventsTable)
      .values(
        allStarts.map((start) => ({
          ...baseEvent,
          seriesId,
          startDatetime: start,
          endDatetime: new Date(start.getTime() + duration),
          signupStartDatetime: new Date(start.getTime() - signupStartOffset),
          signupEndDatetime: new Date(start.getTime() - signupEndOffset),
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
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.description !== undefined) updates.description = req.body.description;
  if (req.body.eventDescription !== undefined) updates.eventDescription = req.body.eventDescription;
  if (req.body.locationName !== undefined) updates.locationName = req.body.locationName;
  if (req.body.locationAddress !== undefined) updates.locationAddress = req.body.locationAddress;
  if (req.body.teamFormat !== undefined) updates.teamFormat = req.body.teamFormat;
  if (req.body.ratingTypeRequired !== undefined) updates.ratingTypeRequired = req.body.ratingTypeRequired;
  if (req.body.ratingConfig !== undefined) updates.ratingConfig = req.body.ratingConfig;
  if (req.body.minParticipants !== undefined) updates.minParticipants = req.body.minParticipants;
  if (req.body.maxParticipants !== undefined) updates.maxParticipants = req.body.maxParticipants;
  if (req.body.waitlistEnabled !== undefined) updates.waitlistEnabled = req.body.waitlistEnabled;
  if (req.body.requireApproval !== undefined) updates.requireApproval = req.body.requireApproval;
  if (req.body.status !== undefined) updates.status = req.body.status;
  if (req.body.courtFeeEnabled !== undefined) updates.courtFeeEnabled = req.body.courtFeeEnabled;
  if (req.body.memberFee !== undefined) updates.memberFee = req.body.memberFee;
  if (req.body.nonMemberFee !== undefined) updates.nonMemberFee = req.body.nonMemberFee;
  if (req.body.contactEmail !== undefined) updates.contactEmail = req.body.contactEmail;
  if (req.body.startDatetime !== undefined) updates.startDatetime = new Date(req.body.startDatetime);
  if (req.body.endDatetime !== undefined) updates.endDatetime = new Date(req.body.endDatetime);
  if (req.body.signupStartDatetime !== undefined) updates.signupStartDatetime = new Date(req.body.signupStartDatetime);
  if (req.body.signupEndDatetime !== undefined) updates.signupEndDatetime = new Date(req.body.signupEndDatetime);

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

  const maxTeams = event.teamFormat === "fixed_partner" ? Math.floor(event.maxParticipants / 2) : null;
  const confirmedTeams = event.teamFormat === "fixed_partner" ? Math.floor(confirmed / 2) : null;
  const waitlistedTeams = event.teamFormat === "fixed_partner" ? Math.floor(waitlisted / 2) : null;
  const pendingTeams = event.teamFormat === "fixed_partner" ? Math.floor(pendingApproval / 2) : null;
  return res.json({
    confirmed,
    waitlisted,
    pendingApproval,
    total: confirmed + waitlisted + pendingApproval,
    maxParticipants: event.maxParticipants,
    maxTeams,
    confirmedTeams,
    waitlistedTeams,
    pendingTeams,
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
