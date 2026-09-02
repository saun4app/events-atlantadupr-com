import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getSession(sid: string | undefined): Promise<Record<string, any> | null> {
  if (!sid) return null;
  const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.token, sid));
  return row?.data as Record<string, any> ?? null;
}

export async function setSession(sid: string, data: Record<string, any>): Promise<void> {
  await db.insert(sessionsTable)
    .values({ token: sid, data })
    .onConflictDoUpdate({ target: sessionsTable.token, set: { data } });
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.token, sid));
}
