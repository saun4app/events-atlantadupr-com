import { Router } from "express";
import { db } from "@workspace/db";
import { eventsTable, registrationsTable } from "@workspace/db";
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

router.post("/", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req, res) => {
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

router.patch("/:id", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req, res) => {
  const [existing] = await db.select().from(eventsTable).where(eq(eventsTable.id, Number(req.params.id)));
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

  const [updated] = await db.update(eventsTable).set(updates).where(eq(eventsTable.id, Number(req.params.id))).returning();
  return res.json(updated);
});

router.delete("/:id", requireAuth, requireRole("admin", "event_organizer"), async (req, res) => {
  const [deleted] = await db.delete(eventsTable).where(eq(eventsTable.id, Number(req.params.id))).returning();
  if (!deleted) return res.status(404).json({ error: "Event not found" });
  return res.status(204).send();
});

router.post("/:id/clone", requireAuth, requireRole("admin", "event_organizer", "event_captain", "court_leader"), async (req, res) => {
  const [source] = await db.select().from(eventsTable).where(eq(eventsTable.id, Number(req.params.id)));
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

router.post("/:id/close", requireAuth, requireRole("admin", "event_organizer"), async (req, res) => {
  const [updated] = await db
    .update(eventsTable)
    .set({ status: "closed" })
    .where(eq(eventsTable.id, Number(req.params.id)))
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

export default router;
