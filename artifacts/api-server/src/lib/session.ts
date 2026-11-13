import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { SESSION_MAX_AGE_MS } from "./security.js";

export async function getSession(sid: string | undefined): Promise<Record<string, any> | null> {
  if (!sid) return null;
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.token, sid));
  if (!row || Date.now() - row.createdAt.getTime() >= SESSION_MAX_AGE_MS) return null;
  return {
    ...(row.data as Record<string, any>),
    sessionExpiresAt: new Date(row.createdAt.getTime() + SESSION_MAX_AGE_MS).toISOString(),
  };
}

export async function setSession(sid: string, data: Record<string, any>): Promise<Date> {
  const [row] = await db.insert(sessionsTable)
    .values({ token: sid, data })
    .onConflictDoUpdate({ target: sessionsTable.token, set: { data } })
    .returning({ createdAt: sessionsTable.createdAt });
  return new Date(row.createdAt.getTime() + SESSION_MAX_AGE_MS);
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.token, sid));
}
