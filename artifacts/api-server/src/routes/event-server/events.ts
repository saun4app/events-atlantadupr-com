import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { eventAssignmentsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole } from "../../lib/auth.js";
import { eventControllers, parseEventType } from "./eventController.js";

// Re-export shared helpers consumed by registrations.ts and other modules.
export {
  parseEventType,
  canAccessEvent,
  getNormalizedEvent,
  type NormalizedEvent,
} from "./eventController.js";

const router = Router();

const writeRoles = ["admin", "event_organizer", "event_captain", "court_leader"] as const;

// Dispatch a request to the controller for its event format. Each format owns
// an independent controller subclass; this router only routes to the right one.
function dispatch(method: "list" | "getById" | "create" | "update" | "remove" | "clone" | "close" | "rosterSummary") {
  return (req: Request, res: Response) => {
    const eventType = parseEventType(req.params.eventType as string);
    if (!eventType) return res.status(404).json({ error: "Unknown event format" });
    return eventControllers[eventType][method](req, res);
  };
}

// Cross-format dashboard summary. Aggregates both independent formats; it does
// not merge them into a shared events feed.
router.get("/summary", async (_req, res) => {
  const now = new Date();
  const allEvents = [
    ...(await eventControllers.rotating.allNormalized()),
    ...(await eventControllers.fixed_partner.allNormalized()),
  ];
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

// Per-format event CRUD. Each format has its own independent listing; there is
// no merged/aggregated events feed.
router.get("/:eventType", dispatch("list"));
router.post("/:eventType", requireAuth, requireRole("admin", "event_organizer"), dispatch("create"));
router.get("/:eventType/:id", dispatch("getById"));
router.patch("/:eventType/:id", requireAuth, requireRole(...writeRoles), dispatch("update"));
router.delete("/:eventType/:id", requireAuth, requireRole(...writeRoles), dispatch("remove"));
router.post("/:eventType/:id/clone", requireAuth, requireRole(...writeRoles), dispatch("clone"));
router.post("/:eventType/:id/close", requireAuth, requireRole(...writeRoles), dispatch("close"));
router.get("/:eventType/:id/roster-summary", dispatch("rosterSummary"));

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
