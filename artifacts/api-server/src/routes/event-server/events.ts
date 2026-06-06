import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  eventsRotatingTable,
  eventsFixedTable,
  registrationsTable,
  eventAssignmentsTable,
  usersTable,
  type EventFormat,
  type EventRatingConfig,
} from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { randomUUID } from "crypto";

const router = Router();

export function parseEventType(raw: string | undefined): EventFormat | null {
  if (raw === "rotating" || raw === "fixed_partner") return raw;
  return null;
}

// A format-agnostic view of an event. The two storage tables are fully
// independent (rotating tracks participant capacity, fixed tracks team
// capacity); this shape lets read paths and registration logic stay uniform.
export interface NormalizedEvent {
  id: number;
  seriesId: string | null;
  name: string;
  description: string | null;
  eventDescription: string | null;
  startDatetime: Date;
  endDatetime: Date;
  locationName: string;
  locationAddress: string;
  teamFormat: EventFormat;
  ratingTypeRequired: string;
  ratingConfig: EventRatingConfig;
  minParticipants: number;
  maxParticipants: number;
  minTeams: number | null;
  maxTeams: number | null;
  waitlistEnabled: boolean;
  requireApproval: string;
  signupStartDatetime: Date;
  signupEndDatetime: Date;
  status: string;
  courtFeeEnabled: boolean;
  memberFee: number;
  nonMemberFee: number;
  contactEmail: string | null;
  createdAt: Date;
}

function normalizeRotating(r: typeof eventsRotatingTable.$inferSelect): NormalizedEvent {
  return {
    ...r,
    teamFormat: "rotating",
    minTeams: null,
    maxTeams: null,
  };
}

function normalizeFixed(r: typeof eventsFixedTable.$inferSelect): NormalizedEvent {
  const { minTeams, maxTeams, ...rest } = r;
  return {
    ...rest,
    teamFormat: "fixed_partner",
    minTeams,
    maxTeams,
    minParticipants: minTeams * 2,
    maxParticipants: maxTeams * 2,
  };
}

export async function getNormalizedEvent(
  eventType: EventFormat,
  eventId: number,
): Promise<NormalizedEvent | null> {
  if (eventType === "rotating") {
    const [r] = await db.select().from(eventsRotatingTable).where(eq(eventsRotatingTable.id, eventId));
    return r ? normalizeRotating(r) : null;
  }
  const [r] = await db.select().from(eventsFixedTable).where(eq(eventsFixedTable.id, eventId));
  return r ? normalizeFixed(r) : null;
}

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

export async function canAccessEvent(eventId: number, eventType: EventFormat, req: Request): Promise<boolean> {
  const session = (req as any).session;
  if (!session?.userId) return false;
  const role: string = session.role ?? "";
  if (role === "admin" || role === "event_organizer") return true;
  if (role === "event_captain" || role === "court_leader") {
    const [assignment] = await db
      .select()
      .from(eventAssignmentsTable)
      .where(
        and(
          eq(eventAssignmentsTable.userId, Number(session.userId)),
          eq(eventAssignmentsTable.eventId, eventId),
          eq(eventAssignmentsTable.eventType, eventType),
        ),
      );
    return !!assignment;
  }
  return false;
}

router.get("/summary", async (_req, res) => {
  const now = new Date();
  const rotating = (await db.select().from(eventsRotatingTable)).map(normalizeRotating);
  const fixed = (await db.select().from(eventsFixedTable)).map(normalizeFixed);
  const allEvents = [...rotating, ...fixed];
  const totalUpcoming = allEvents.filter(
    (e) => new Date(e.startDatetime) > now && e.status !== "ended" && e.status !== "cancelled",
  ).length;
  const openForSignup = allEvents.filter(
    (e) =>
      e.status === "upcoming" &&
      new Date(e.signupStartDatetime) <= now &&
      new Date(e.signupEndDatetime) >= now,
  ).length;
  return res.json({ totalUpcoming, openForSignup, totalEvents: allEvents.length });
});

// Per-format list. Each format has its own independent listing; there is no
// merged/aggregated events feed.
router.get("/:eventType", async (req, res) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });

  const { upcoming, search } = req.query as Record<string, string>;
  let rows: NormalizedEvent[];
  if (eventType === "rotating") {
    rows = (await db.select().from(eventsRotatingTable).orderBy(eventsRotatingTable.startDatetime)).map(normalizeRotating);
  } else {
    rows = (await db.select().from(eventsFixedTable).orderBy(eventsFixedTable.startDatetime)).map(normalizeFixed);
  }

  if (upcoming === "true") {
    const now = new Date();
    rows = rows.filter((e) => new Date(e.startDatetime) >= now && e.status !== "ended" && e.status !== "cancelled");
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
    .where(and(eq(registrationsTable.status, "confirmed"), eq(registrationsTable.eventType, eventType)))
    .groupBy(registrationsTable.eventId);
  const countMap = Object.fromEntries(counts.map((c) => [c.eventId, c.confirmedCount]));

  return res.json(
    rows.map((r) => {
      const confirmedCount = countMap[r.id] ?? 0;
      const confirmedTeams = r.teamFormat === "fixed_partner" ? Math.floor(confirmedCount / 2) : null;
      const maxTeams = r.maxTeams;
      return { ...r, confirmedCount, confirmedTeams, maxTeams };
    }),
  );
});

function buildCommonBase(body: any) {
  return {
    name: body.name,
    description: body.description ?? null,
    eventDescription: body.eventDescription ?? null,
    locationName: body.locationName,
    locationAddress: body.locationAddress ?? "",
    ratingTypeRequired: body.ratingTypeRequired ?? "none",
    ratingConfig: body.ratingConfig ?? null,
    waitlistEnabled: body.waitlistEnabled ?? true,
    requireApproval: body.requireApproval ?? "none",
    status: "upcoming" as const,
    courtFeeEnabled: body.courtFeeEnabled ?? false,
    memberFee: typeof body.memberFee === "number" ? body.memberFee : 0,
    nonMemberFee: typeof body.nonMemberFee === "number" ? body.nonMemberFee : 0,
    contactEmail: body.contactEmail ?? null,
  };
}

router.post("/:eventType", requireAuth, requireRole("admin", "event_organizer"), async (req, res) => {
  const eventType = parseEventType(req.params.eventType as string);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });

  const body = req.body;
  const { startDatetime, endDatetime, signupStartDatetime, signupEndDatetime, recurrence } = body;
  const common = buildCommonBase(body);

  // Capacity fields are format-specific: rotating tracks participants, fixed
  // tracks teams.
  const capacity =
    eventType === "rotating"
      ? { minParticipants: body.minParticipants ?? 4, maxParticipants: body.maxParticipants ?? 16 }
      : { minTeams: body.minTeams ?? 2, maxTeams: body.maxTeams ?? 8 };
  const baseEvent: any = { ...common, ...capacity };

  const startList: Date[] = [new Date(startDatetime)];
  let seriesId: string | null = null;
  let duration = new Date(endDatetime).getTime() - new Date(startDatetime).getTime();
  let signupStartOffset = new Date(startDatetime).getTime() - new Date(signupStartDatetime).getTime();
  let signupEndOffset = new Date(startDatetime).getTime() - new Date(signupEndDatetime).getTime();

  if (recurrence) {
    seriesId = randomUUID();
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
    startList.push(...additionalStarts);
  }

  const values = startList.map((start) => ({
    ...baseEvent,
    seriesId,
    startDatetime: start,
    endDatetime: new Date(start.getTime() + duration),
    signupStartDatetime: new Date(start.getTime() - signupStartOffset),
    signupEndDatetime: new Date(start.getTime() - signupEndOffset),
  }));

  if (eventType === "rotating") {
    const created = await db.insert(eventsRotatingTable).values(values).returning();
    return res.status(201).json(created.map(normalizeRotating));
  }
  const created = await db.insert(eventsFixedTable).values(values).returning();
  return res.status(201).json(created.map(normalizeFixed));
});

router.get("/:eventType/:id", async (req, res) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const event = await getNormalizedEvent(eventType, Number(req.params.id));
  if (!event) return res.status(404).json({ error: "Event not found" });
  return res.json(event);
});

router.patch(
  "/:eventType/:id",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<{ eventType: string; id: string }>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const existing = await getNormalizedEvent(eventType, eventId);
    if (!existing) return res.status(404).json({ error: "Event not found" });

    const b = req.body;
    const updates: any = {};
    if (b.name !== undefined) updates.name = b.name;
    if (b.description !== undefined) updates.description = b.description;
    if (b.eventDescription !== undefined) updates.eventDescription = b.eventDescription;
    if (b.locationName !== undefined) updates.locationName = b.locationName;
    if (b.locationAddress !== undefined) updates.locationAddress = b.locationAddress;
    if (b.ratingTypeRequired !== undefined) updates.ratingTypeRequired = b.ratingTypeRequired;
    if (b.ratingConfig !== undefined) updates.ratingConfig = b.ratingConfig;
    if (b.waitlistEnabled !== undefined) updates.waitlistEnabled = b.waitlistEnabled;
    if (b.requireApproval !== undefined) updates.requireApproval = b.requireApproval;
    if (b.status !== undefined) updates.status = b.status;
    if (b.courtFeeEnabled !== undefined) updates.courtFeeEnabled = b.courtFeeEnabled;
    if (b.memberFee !== undefined) updates.memberFee = b.memberFee;
    if (b.nonMemberFee !== undefined) updates.nonMemberFee = b.nonMemberFee;
    if (b.contactEmail !== undefined) updates.contactEmail = b.contactEmail;
    if (b.startDatetime !== undefined) updates.startDatetime = new Date(b.startDatetime);
    if (b.endDatetime !== undefined) updates.endDatetime = new Date(b.endDatetime);
    if (b.signupStartDatetime !== undefined) updates.signupStartDatetime = new Date(b.signupStartDatetime);
    if (b.signupEndDatetime !== undefined) updates.signupEndDatetime = new Date(b.signupEndDatetime);

    if (eventType === "rotating") {
      if (b.minParticipants !== undefined) updates.minParticipants = b.minParticipants;
      if (b.maxParticipants !== undefined) updates.maxParticipants = b.maxParticipants;
      const [updated] = await db
        .update(eventsRotatingTable)
        .set(updates)
        .where(eq(eventsRotatingTable.id, eventId))
        .returning();
      return res.json(normalizeRotating(updated));
    }
    if (b.minTeams !== undefined) updates.minTeams = b.minTeams;
    if (b.maxTeams !== undefined) updates.maxTeams = b.maxTeams;
    const [updated] = await db.update(eventsFixedTable).set(updates).where(eq(eventsFixedTable.id, eventId)).returning();
    return res.json(normalizeFixed(updated));
  },
);

router.delete(
  "/:eventType/:id",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<{ eventType: string; id: string }>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }

    const table = eventType === "rotating" ? eventsRotatingTable : eventsFixedTable;
    const [deleted] = await db.delete(table).where(eq(table.id, eventId)).returning();
    if (!deleted) return res.status(404).json({ error: "Event not found" });

    // No cross-table FK exists, so cascade dependent rows at the application
    // level scoped to this event's format.
    await db
      .delete(registrationsTable)
      .where(and(eq(registrationsTable.eventId, eventId), eq(registrationsTable.eventType, eventType)));
    await db
      .delete(eventAssignmentsTable)
      .where(and(eq(eventAssignmentsTable.eventId, eventId), eq(eventAssignmentsTable.eventType, eventType)));
    return res.status(204).send();
  },
);

router.post(
  "/:eventType/:id/clone",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<{ eventType: string; id: string }>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }
    const { name } = req.body ?? {};

    if (eventType === "rotating") {
      const [source] = await db.select().from(eventsRotatingTable).where(eq(eventsRotatingTable.id, eventId));
      if (!source) return res.status(404).json({ error: "Source event not found" });
      const { id: _id, createdAt: _c, seriesId: _s, ...rest } = source;
      const [cloned] = await db
        .insert(eventsRotatingTable)
        .values({ ...rest, name: name ?? `${source.name} (Copy)`, status: "upcoming" })
        .returning();
      return res.status(201).json(normalizeRotating(cloned));
    }
    const [source] = await db.select().from(eventsFixedTable).where(eq(eventsFixedTable.id, eventId));
    if (!source) return res.status(404).json({ error: "Source event not found" });
    const { id: _id, createdAt: _c, seriesId: _s, ...rest } = source;
    const [cloned] = await db
      .insert(eventsFixedTable)
      .values({ ...rest, name: name ?? `${source.name} (Copy)`, status: "upcoming" })
      .returning();
    return res.status(201).json(normalizeFixed(cloned));
  },
);

router.post(
  "/:eventType/:id/close",
  requireAuth,
  requireRole("admin", "event_organizer", "event_captain", "court_leader"),
  async (req: Request<{ eventType: string; id: string }>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    if (!(await canAccessEvent(eventId, eventType, req))) {
      return res.status(403).json({ error: "Forbidden: not assigned to this event" });
    }
    const table = eventType === "rotating" ? eventsRotatingTable : eventsFixedTable;
    const [updated] = await db.update(table).set({ status: "closed" }).where(eq(table.id, eventId)).returning();
    if (!updated) return res.status(404).json({ error: "Event not found" });
    return res.json(eventType === "rotating" ? normalizeRotating(updated as any) : normalizeFixed(updated as any));
  },
);

router.get("/:eventType/:id/roster-summary", async (req, res) => {
  const eventType = parseEventType(req.params.eventType);
  if (!eventType) return res.status(404).json({ error: "Unknown event format" });
  const eventId = Number(req.params.id);
  const event = await getNormalizedEvent(eventType, eventId);
  if (!event) return res.status(404).json({ error: "Event not found" });

  const regs = await db
    .select()
    .from(registrationsTable)
    .where(and(eq(registrationsTable.eventId, eventId), eq(registrationsTable.eventType, eventType)));
  const confirmed = regs.filter((r) => r.status === "confirmed").length;
  const waitlisted = regs.filter((r) => r.status === "waitlisted").length;
  const pendingApproval = regs.filter((r) => r.status === "pending_approval").length;

  const isFixed = event.teamFormat === "fixed_partner";
  return res.json({
    confirmed,
    waitlisted,
    pendingApproval,
    total: confirmed + waitlisted + pendingApproval,
    maxParticipants: event.maxParticipants,
    maxTeams: isFixed ? Math.floor(event.maxParticipants / 2) : null,
    confirmedTeams: isFixed ? Math.floor(confirmed / 2) : null,
    waitlistedTeams: isFixed ? Math.floor(waitlisted / 2) : null,
    pendingTeams: isFixed ? Math.floor(pendingApproval / 2) : null,
  });
});

router.get(
  "/:eventType/:id/assignments",
  requireAuth,
  requireRole("admin", "event_organizer"),
  async (req: Request<{ eventType: string; id: string }>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    const assignments = await db
      .select({
        userId: eventAssignmentsTable.userId,
        eventId: eventAssignmentsTable.eventId,
        eventType: eventAssignmentsTable.eventType,
        assignedAt: eventAssignmentsTable.assignedAt,
        userName: usersTable.name,
        userUsername: usersTable.username,
        userRole: usersTable.role,
      })
      .from(eventAssignmentsTable)
      .innerJoin(usersTable, eq(usersTable.id, eventAssignmentsTable.userId))
      .where(and(eq(eventAssignmentsTable.eventId, eventId), eq(eventAssignmentsTable.eventType, eventType)));
    return res.json(assignments);
  },
);

router.post(
  "/:eventType/:id/assignments",
  requireAuth,
  requireRole("admin", "event_organizer"),
  async (req: Request<{ eventType: string; id: string }>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
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
      .values({ userId: Number(userId), eventId, eventType })
      .onConflictDoNothing()
      .returning();

    return res.status(201).json(assignment ?? { userId: Number(userId), eventId, eventType, note: "already assigned" });
  },
);

router.delete(
  "/:eventType/:id/assignments/:userId",
  requireAuth,
  requireRole("admin", "event_organizer"),
  async (req: Request<{ eventType: string; id: string; userId: string }>, res: Response) => {
    const eventType = parseEventType(req.params.eventType);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    const eventId = Number(req.params.id);
    const userId = Number(req.params.userId);

    const [deleted] = await db
      .delete(eventAssignmentsTable)
      .where(
        and(
          eq(eventAssignmentsTable.eventId, eventId),
          eq(eventAssignmentsTable.eventType, eventType),
          eq(eventAssignmentsTable.userId, userId),
        ),
      )
      .returning();

    if (!deleted) return res.status(404).json({ error: "Assignment not found" });
    return res.status(204).send();
  },
);

export default router;
