import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole, hashPassword } from "../../lib/auth.js";

const router = Router();

function toPublicUser(u: typeof usersTable.$inferSelect) {
  return { id: u.id, name: u.name, username: u.username, role: u.role, createdAt: u.createdAt };
}

router.get("/", requireRole("admin"), async (_req, res) => {
  const users = await db.select().from(usersTable);
  return res.json(users.map(toPublicUser));
});

router.post("/", requireRole("admin"), async (req, res) => {
  const { name, username, password, role } = req.body;
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: "name, username, password, and role are required" });
  }

  const [user] = await db
    .insert(usersTable)
    .values({ name, username, passwordHash: await hashPassword(password), role })
    .returning();

  return res.status(201).json(toPublicUser(user));
});

router.patch("/:id", requireRole("admin"), async (req, res) => {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, Number(req.params.id)));
  if (!existing) return res.status(404).json({ error: "User not found" });

  const updates: any = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.username !== undefined) updates.username = req.body.username;
  if (req.body.role !== undefined) updates.role = req.body.role;
  if (req.body.password) updates.passwordHash = await hashPassword(req.body.password);

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, Number(req.params.id)))
    .returning();

  return res.json(toPublicUser(updated));
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, Number(req.params.id))).returning();
  if (!deleted) return res.status(404).json({ error: "User not found" });
  return res.status(204).send();
});

export default router;
