import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole, hashPassword } from "../../lib/auth.js";
import { canonicalizeUserRole, USER_ROLE_GROUPS, USER_ROLE_IDS, hasUserRole, isConfiguredUserRole } from "../../lib/user-roles.js";
import { DeleteUserParams, UpdateUserBody, UpdateUserParams, UpdateUserResponse } from "@workspace/api-zod";

const router = Router();

function toPublicUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    role: canonicalizeUserRole(u.role),
    createdAt: u.createdAt,
    duprId: u.duprId,
    duprFullname: u.duprFullname,
  };
}

router.get("/", requireRole(USER_ROLE_IDS.app_admin), async (_req, res) => {
  const users = await db.select().from(usersTable);
  return res.json(users.map(toPublicUser));
});

router.get("/assignable-staff", requireRole(...USER_ROLE_GROUPS.eventManagers), async (_req, res) => {
  const users = await db.select().from(usersTable);
  return res.json(users.filter((user) => hasUserRole(user.role, "assignableStaff")).map(toPublicUser));
});

router.post("/", requireRole(USER_ROLE_IDS.app_admin), async (req, res) => {
  const { name, username, password, role } = req.body;
  if (!name || !username || !password || !role) {
    return res.status(400).json({ error: "name, username, password, and role are required" });
  }
  if (!isConfiguredUserRole(role)) {
    return res.status(400).json({ error: "Invalid user role" });
  }

  const [user] = await db
    .insert(usersTable)
    .values({ name, username, passwordHash: await hashPassword(password), role })
    .returning();

  return res.status(201).json(toPublicUser(user));
});

router.patch("/:id", requireRole(USER_ROLE_IDS.app_admin), async (req, res): Promise<void> => {
  const parsedParams = UpdateUserParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }

  const parsedBody = UpdateUserBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, parsedParams.data.id));
  if (!existing) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (parsedBody.data.name !== undefined) updates.name = parsedBody.data.name;
  if (parsedBody.data.username !== undefined) updates.username = parsedBody.data.username;
  if (parsedBody.data.role !== undefined) {
    if (!isConfiguredUserRole(parsedBody.data.role)) {
      res.status(400).json({ error: "Invalid user role" });
      return;
    }
    updates.role = parsedBody.data.role;
  }
  if (parsedBody.data.password) updates.passwordHash = await hashPassword(parsedBody.data.password);
  if (parsedBody.data.duprId !== undefined) updates.duprId = parsedBody.data.duprId?.trim() || null;
  if (parsedBody.data.duprFullname !== undefined) updates.duprFullname = parsedBody.data.duprFullname?.trim() || null;

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, parsedParams.data.id))
    .returning();

  res.json(UpdateUserResponse.parse(toPublicUser(updated)));
});

router.delete("/:id", requireRole(USER_ROLE_IDS.app_admin), async (req, res) => {
  const parsedParams = DeleteUserParams.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }

  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, parsedParams.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.status(204).send();
});

export default router;
