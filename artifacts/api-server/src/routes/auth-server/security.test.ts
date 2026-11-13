import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { assertTestDatabase, db, sessionsTable, usersTable } from "@workspace/db";
import app from "../../app.js";
import { hashPassword } from "../../lib/auth.js";
import {
  createSessionToken,
  sessionCookieOptions,
  SESSION_MAX_AGE_MS,
} from "../../lib/security.js";
import { setSession } from "../../lib/session.js";

let server: Server;
let base: string;
let userId: number;
const username = `security-${randomUUID()}`;
const password = createSessionToken();

before(async () => {
  await assertTestDatabase();
  const [user] = await db.insert(usersTable).values({
    name: "Disposable security test", username, passwordHash: await hashPassword(password), role: "app_admin",
  }).returning();
  userId = user.id;
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  if (userId) {
    await db.delete(sessionsTable).where(sql`${sessionsTable.data}->>'userId' = ${String(userId)}`);
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function login() {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://events.atlantadupr.com" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { token: string; sessionExpiresAt: string };
  return { response, token: body.token, sessionExpiresAt: body.sessionExpiresAt };
}

test("login persists a strong bearer token and matching signed HttpOnly cookie", async () => {
  const { response, token, sessionExpiresAt } = await login();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const expiresAtMs = Date.parse(sessionExpiresAt);
  assert.ok(expiresAtMs > Date.now());
  assert.ok(expiresAtMs <= Date.now() + SESSION_MAX_AGE_MS + 1_000);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax|SameSite=None/i);
  assert.ok(decodeURIComponent(cookie).includes(`s:${token}.`));
  const me = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  const meBody = await me.json() as { id: number; sessionExpiresAt: string; token?: string };
  assert.equal(meBody.id, userId);
  assert.equal(meBody.sessionExpiresAt, sessionExpiresAt);
  assert.equal("token" in meBody, false);

  const reloadedMe = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await reloadedMe.json() as { sessionExpiresAt: string }).sessionExpiresAt, sessionExpiresAt);
});

test("Replit preview sessions keep cross-site iframe cookie settings", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDevDomain = process.env.REPLIT_DEV_DOMAIN;
  try {
    process.env.NODE_ENV = "development";
    process.env.REPLIT_DEV_DOMAIN = "preview.example.replit.dev";
    const options = sessionCookieOptions();
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, "none");
    assert.equal(options.httpOnly, true);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDevDomain === undefined) delete process.env.REPLIT_DEV_DOMAIN;
    else process.env.REPLIT_DEV_DOMAIN = previousDevDomain;
  }
});

test("untrusted origins cannot read or mutate authenticated APIs", async () => {
  const { token } = await login();
  const response = await fetch(`${base}/auth/logout`, {
    method: "POST", headers: { Origin: "https://attacker.example", Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const me = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
});

test("logout revokes the bearer token instead of only clearing cookies", async () => {
  const { token } = await login();
  const response = await fetch(`${base}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 204);
  const me = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 401);
});

test("expired server-side sessions cannot bypass cookie expiration", async () => {
  const token = createSessionToken();
  await setSession(token, { userId, role: "app_admin", username });
  await db.update(sessionsTable).set({ createdAt: new Date(Date.now() - SESSION_MAX_AGE_MS - 1000) }).where(eq(sessionsTable.token, token));
  const me = await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 401);
});

test("malformed login input is rejected rather than causing a server error", async () => {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: {}, password: [] }),
  });
  assert.equal(response.status, 400);
});
