import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyPassword } from "../../lib/auth.js";
import { deleteSession, setSession } from "../../lib/session.js";
import {
  getClientIp,
  recordAttempt,
  recordSuccess,
  rateLimitErrorResponse,
} from "../../lib/rate-limit.js";

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

  (req as any).session = { userId: user.id, role: user.role, name: user.name, username: user.username };

  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await setSession(token, (req as any).session);

  return res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    token,
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

router.get("/me", (req, res) => {
  const session = (req as any).session;
  if (!session?.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  return res.json({
    id: session.userId,
    name: session.name,
    username: session.username,
    role: session.role,
    createdAt: new Date().toISOString(),
  });
});

export default router;
