import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  assertTestDatabase,
  db,
  pool,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "../src/lib/auth.js";
import { SESSION_MAX_AGE_MS } from "../src/lib/security.js";

type FixtureCommand =
  | { action: "create" }
  | { action: "expire"; userId: number; username: string }
  | { action: "cleanup"; userId: number; username: string };

function isFixtureCommand(value: unknown): value is FixtureCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  if (command.action === "create") return true;
  return (
    (command.action === "expire" || command.action === "cleanup") &&
    Number.isSafeInteger(command.userId) &&
    Number(command.userId) > 0 &&
    typeof command.username === "string" &&
    command.username.startsWith("e2e-sign-in-")
  );
}

async function run(command: FixtureCommand) {
  await assertTestDatabase();

  if (command.action === "create") {
    const username = `e2e-sign-in-${randomUUID()}`;
    const password = randomBytes(32).toString("base64url");
    const [user] = await db
      .insert(usersTable)
      .values({
        name: "Disposable browser sign-in test",
        username,
        passwordHash: await hashPassword(password),
        role: "app_admin",
      })
      .returning({ id: usersTable.id });

    process.stdout.write(
      JSON.stringify({ userId: user.id, username, password }),
    );
    return;
  }

  const matchingSessions = sql`${sessionsTable.data}->>'userId' = ${String(command.userId)} AND ${sessionsTable.data}->>'username' = ${command.username}`;

  if (command.action === "expire") {
    const result = await db
      .update(sessionsTable)
      .set({ createdAt: new Date(Date.now() - SESSION_MAX_AGE_MS - 1000) })
      .where(matchingSessions)
      .returning({ createdAt: sessionsTable.createdAt });
    if (result.length === 0) {
      throw new Error("No disposable account session was available to expire.");
    }
    process.stdout.write(JSON.stringify({ expired: true }));
    return;
  }

  await db.delete(sessionsTable).where(matchingSessions);
  await db
    .delete(usersTable)
    .where(
      sql`${usersTable.id} = ${command.userId} AND ${usersTable.username} = ${command.username}`,
    );

  const [remainingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      sql`${usersTable.id} = ${command.userId} AND ${usersTable.username} = ${command.username}`,
    );
  const [remainingSession] = await db
    .select({ createdAt: sessionsTable.createdAt })
    .from(sessionsTable)
    .where(matchingSessions);
  if (remainingUser || remainingSession) {
    throw new Error(
      "Disposable account cleanup did not remove all fixture data.",
    );
  }
  process.stdout.write(JSON.stringify({ cleaned: true }));
}

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const parsed: unknown = JSON.parse(input);
  if (!isFixtureCommand(parsed)) {
    throw new Error("Invalid fixture command");
  }
  await run(parsed);
} catch {
  console.error("Browser sign-in fixture operation failed.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
