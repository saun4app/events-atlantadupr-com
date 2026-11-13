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

type FixtureCommand =
  | { action: "create" }
  | { action: "cleanup"; userId: number; username: string };

function isFixtureCommand(value: unknown): value is FixtureCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Record<string, unknown>;
  if (command.action === "create") return true;
  return (
    command.action === "cleanup" &&
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

  await db
    .delete(sessionsTable)
    .where(sql`${sessionsTable.data}->>'userId' = ${String(command.userId)}`);
  await db
    .delete(usersTable)
    .where(
      sql`${usersTable.id} = ${command.userId} AND ${usersTable.username} = ${command.username}`,
    );
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
