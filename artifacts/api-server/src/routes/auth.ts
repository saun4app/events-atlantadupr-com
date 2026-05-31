import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { deleteSession } from "../lib/session.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  (req as any).session = { userId: user.id, role: user.role, name: user.name, username: user.username };

  return res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
  });
});

router.post("/logout", (req, res) => {
  const sid = req.signedCookies?.sid;
  if (sid) {
    deleteSession(sid);
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
