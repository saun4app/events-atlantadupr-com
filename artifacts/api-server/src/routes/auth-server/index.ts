import { Router } from "express";
import { db } from "@workspace/db";
import { eventAssignmentsTable, usersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { verifyPassword } from "../../lib/auth.js";
import { deleteSession, setSession } from "../../lib/session.js";
import {
  getClientIp,
  recordAttempt,
  recordSuccess,
  rateLimitErrorResponse,
} from "../../lib/rate-limit.js";
import { canonicalizeUserRole } from "../../lib/user-roles.js";

const router = Router();

const LOGIN_CONFIG = {
  maxAttempts: 5,
  windowMs: 10 * 60 * 1000, // 10 minutes
  blockMs: 15 * 60 * 1000,  // 15 minutes
};

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const clientIp = getClientIp(req);
  const usernameKey = username.trim().toLowerCase();

  // Check rate limits by IP and by username
  const ipResult = recordAttempt(clientIp, "login:ip", LOGIN_CONFIG);
  if (ipResult.blocked) {
    return rateLimitErrorResponse(res, ipResult.remainingBlockMs);
  }

  const userResult = recordAttempt(usernameKey, "login:user", LOGIN_CONFIG);
  if (userResult.blocked) {
    return rateLimitErrorResponse(res, userResult.remainingBlockMs);
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Success: clear rate-limit counters
  recordSuccess(clientIp, "login:ip");
  recordSuccess(usernameKey, "login:user");

  // Existing deployments may still contain legacy admin values. Normalize all
  // of them on the first successful login without changing any other roles.
  await db
    .update(usersTable)
    .set({ role: "app_admin" })
    .where(eq(usersTable.role, "admin"));
  await db
    .update(usersTable)
    .set({ role: "club_member" })
    .where(inArray(usersTable.role, ["event_participant", "event_organizer", "event_captain", "court_leader"]));

  const role = ["event_organizer", "event_captain", "court_leader"].includes(user.role)
    ? "club_member"
    : canonicalizeUserRole(user.role);
  if (role !== user.role) {
    await db
      .update(usersTable)
      .set({ role })
      .where(and(eq(usersTable.id, user.id), eq(usersTable.role, user.role)));
  }

  (req as any).session = {
    userId: user.id,
    role,
    name: user.name,
    username: user.username,
    duprId: user.duprId,
    duprFullname: user.duprFullname,
  };

  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await setSession(token, (req as any).session);

  const eventAssignments = await db.select({
    eventId: eventAssignmentsTable.eventId, eventType: eventAssignmentsTable.eventType,
    eventRole: eventAssignmentsTable.eventRole,
  }).from(eventAssignmentsTable).where(eq(eventAssignmentsTable.userId, user.id));
  return res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    role,
    createdAt: user.createdAt,
    duprId: user.duprId,
    duprFullname: user.duprFullname,
    token,
    eventAssignments,
  });
});

router.post("/logout", async (req, res) => {
  const sid = req.signedCookies?.sid;
  if (sid) {
    await deleteSession(sid);
  }
  (req as any).session = null;
  res.clearCookie("sid");
  return res.status(204).send();
});

router.get("/me", async (req, res) => {
  const session = (req as any).session;
  if (!session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const eventAssignments = await db.select({
    eventId: eventAssignmentsTable.eventId, eventType: eventAssignmentsTable.eventType,
    eventRole: eventAssignmentsTable.eventRole,
  }).from(eventAssignmentsTable).where(eq(eventAssignmentsTable.userId, session.userId));
  return res.json({
    id: session.userId,
    name: session.name,
    username: session.username,
    role: session.role,
    createdAt: new Date().toISOString(),
    duprId: session.duprId ?? null,
    duprFullname: session.duprFullname ?? null,
    eventAssignments,
  });
});

export default router;
