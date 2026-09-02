import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Server, AddressInfo } from "node:net";

import { db, pool } from "@workspace/db";
import {
  registrationsTable,
  membersTable,
  eventsFixedTable,
  eventsRotatingTable,
  emailVerificationCodesTable,
  sessionsTable,
  usersTable,
  userRoleIdMap,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

import app from "../../app.js";
import { issueCode } from "../../lib/verification.js";

// These tests exercise the create-registration handler's de-duplication and
// reactivation behavior end-to-end over HTTP. They drive the request through the
// staff path (an authenticated admin session via a bearer token) so that the
// signup-window, verification-code and rate-limiting branches are bypassed and
// the test focuses purely on the dedup/reactivation/status logic, which is
// identical for staff and public callers.

const STAFF_TOKEN = "test-staff-token-" + Math.random().toString(36).slice(2);

let server: Server;
let baseUrl: string;

// Track everything we create so each test cleans up after itself; the table has
// no uniqueness constraints, so leftover rows could silently corrupt later runs.
const createdEventIds: number[] = [];
const createdFixedEventIds: number[] = [];
const createdMemberIds: string[] = [];
const createdEmails: string[] = [];
const createdUserIds: number[] = [];

async function createEvent(
  overrides: Partial<typeof eventsRotatingTable.$inferInsert> = {},
) {
  const now = Date.now();
  const [ev] = await db
    .insert(eventsRotatingTable)
    .values({
      name: "Test Event " + Math.random().toString(36).slice(2),
      startDatetime: new Date(now + 7 * 86_400_000),
      endDatetime: new Date(now + 7 * 86_400_000 + 3_600_000),
      locationName: "Test Court",
      signupStartDatetime: new Date(now - 86_400_000),
      signupEndDatetime: new Date(now + 6 * 86_400_000),
      status: "upcoming",
      maxParticipants: 16,
      waitlistEnabled: true,
      requireApproval: "none",
      ...overrides,
    })
    .returning();
  createdEventIds.push(ev.id);
  return ev;
}

async function createMember(
  overrides: Partial<typeof membersTable.$inferInsert> = {},
) {
  const duprId =
    overrides.duprId ?? "T" + Math.random().toString(36).slice(2, 10).toUpperCase();
  const [m] = await db
    .insert(membersTable)
    .values({
      duprId,
      name: "Test Player",
      doubles: "3.500",
      email: `${duprId.toLowerCase()}@test.local`,
      ...overrides,
    })
    .returning();
  createdMemberIds.push(m.duprId);
  if (m.email) createdEmails.push(m.email);
  return m;
}

async function insertReg(
  eventId: number,
  memberDuprId: string,
  status: typeof registrationsTable.$inferInsert["status"],
  overrides: Partial<typeof registrationsTable.$inferInsert> = {},
  eventType: "rotating" | "fixed_partner" = "rotating",
) {
  const [r] = await db
    .insert(registrationsTable)
    .values({
      eventId,
      eventType,
      memberDuprId,
      status,
      playerSnapshot: {
        name: "Test Player",
        doubles: "3.500",
        singles: null,
        selfRating: null,
        email: null,
        phone: null,
      },
      ...(status === "cancelled"
        ? { cancelledAt: new Date(), cancelledBy: "self" }
        : {}),
      ...overrides,
    })
    .returning();
  return r;
}

async function register(eventId: number, memberDuprId: string) {
  const res = await fetch(
    `${baseUrl}/events/rotating/${eventId}/registrations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${STAFF_TOKEN}`,
      },
      body: JSON.stringify({ memberDuprId }),
    },
  );
  const body = (await res.json().catch(() => null)) as any;
  return { status: res.status, body };
}

async function registerFixed(
  eventId: number,
  memberDuprId: string,
  partnerDuprId: string,
) {
  const res = await fetch(
    `${baseUrl}/events/fixed_partner/${eventId}/registrations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${STAFF_TOKEN}`,
      },
      body: JSON.stringify({ memberDuprId, partnerDuprId }),
    },
  );
  const body = (await res.json().catch(() => null)) as any;
  return { status: res.status, body };
}

async function updateFixedEvent(eventId: number, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/events/fixed_partner/${eventId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${STAFF_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const responseBody = (await res.json().catch(() => null)) as any;
  return { status: res.status, body: responseBody };
}

async function updateRotatingEvent(eventId: number, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/events/rotating/${eventId}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${STAFF_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const responseBody = (await res.json().catch(() => null)) as any;
  return { status: res.status, body: responseBody };
}

async function createFixedEventViaApi(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const body = {
    name: "API Fixed Partner Test " + Math.random().toString(36).slice(2),
    locationName: "Test Court",
    startDatetime: new Date(now + 7 * 86_400_000).toISOString(),
    endDatetime: new Date(now + 7 * 86_400_000 + 3_600_000).toISOString(),
    signupStartDatetime: new Date(now - 86_400_000).toISOString(),
    signupEndDatetime: new Date(now + 6 * 86_400_000).toISOString(),
    ...overrides,
  };
  const res = await fetch(`${baseUrl}/events/fixed_partner`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${STAFF_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const responseBody = (await res.json().catch(() => null)) as any;
  return { status: res.status, body: responseBody, name: body.name };
}

async function createRotatingEventViaApi(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  const body = {
    name: "API Rotating Test " + Math.random().toString(36).slice(2),
    locationName: "Test Court",
    startDatetime: new Date(now + 7 * 86_400_000).toISOString(),
    endDatetime: new Date(now + 7 * 86_400_000 + 3_600_000).toISOString(),
    signupStartDatetime: new Date(now - 86_400_000).toISOString(),
    signupEndDatetime: new Date(now + 6 * 86_400_000).toISOString(),
    ...overrides,
  };
  const res = await fetch(`${baseUrl}/events/rotating`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${STAFF_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const responseBody = (await res.json().catch(() => null)) as any;
  return { status: res.status, body: responseBody, name: body.name };
}

async function registerPublic(
  eventId: number,
  email: string,
  body: Record<string, unknown> = {},
) {
  const code = await issueCode(email);
  assert.equal(typeof code, "string");
  const res = await fetch(
    `${baseUrl}/events/rotating/${eventId}/registrations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code, ...body }),
    },
  );
  const responseBody = (await res.json().catch(() => null)) as any;
  return { status: res.status, body: responseBody };
}

async function approve(
  eventId: number,
  registrationId: number,
  eventType: "rotating" | "fixed_partner" = "rotating",
) {
  const res = await fetch(
    `${baseUrl}/events/${eventType}/${eventId}/registrations/${registrationId}/approve`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${STAFF_TOKEN}`,
      },
    },
  );
  const body = (await res.json().catch(() => null)) as any;
  return { status: res.status, body };
}

async function promote(
  eventId: number,
  registrationId: number,
  eventType: "rotating" | "fixed_partner" = "rotating",
) {
  const res = await fetch(
    `${baseUrl}/events/${eventType}/${eventId}/registrations/${registrationId}/promote`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${STAFF_TOKEN}`,
      },
    },
  );
  const body = (await res.json().catch(() => null)) as any;
  return { status: res.status, body };
}

async function editRegistration(
  eventId: number,
  registrationId: number,
  body: Record<string, unknown>,
  eventType: "rotating" | "fixed_partner" = "rotating",
) {
  const res = await fetch(
    `${baseUrl}/events/${eventType}/${eventId}/registrations/${registrationId}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${STAFF_TOKEN}`,
      },
      body: JSON.stringify(body),
    },
  );
  const responseBody = (await res.json().catch(() => null)) as any;
  return { status: res.status, body: responseBody };
}

async function memberRows(eventId: number, memberDuprId: string) {
  return db
    .select()
    .from(registrationsTable)
    .where(
      and(
        eq(registrationsTable.eventId, eventId),
        eq(registrationsTable.eventType, "rotating"),
        eq(registrationsTable.memberDuprId, memberDuprId),
      ),
    );
}

async function createFixedEvent(
  overrides: Partial<typeof eventsFixedTable.$inferInsert> = {},
) {
  const now = Date.now();
  const [event] = await db
    .insert(eventsFixedTable)
    .values({
      name: "Fixed Partner Test " + Math.random().toString(36).slice(2),
      startDatetime: new Date(now + 7 * 86_400_000),
      endDatetime: new Date(now + 7 * 86_400_000 + 3_600_000),
      locationName: "Test Court",
      locationAddress: "Test Address",
      minTeams: 1,
      maxTeams: 8,
      waitlistEnabled: true,
      requireApproval: "none",
      signupStartDatetime: new Date(now - 86_400_000),
      signupEndDatetime: new Date(now + 6 * 86_400_000),
      status: "upcoming",
      ...overrides,
    })
    .returning();
  createdFixedEventIds.push(event.id);
  return event;
}

before(async () => {
  const [staffUser] = await db
    .insert(usersTable)
    .values({
      name: "Test Staff",
      username: "test-staff-" + Math.random().toString(36).slice(2),
      passwordHash: "test-password-hash",
      role: userRoleIdMap.app_admin,
    })
    .returning();
  createdUserIds.push(staffUser.id);

  await db
    .insert(sessionsTable)
  .values({ token: STAFF_TOKEN, data: { userId: staffUser.id, role: userRoleIdMap.app_admin } })
    .onConflictDoUpdate({
      target: sessionsTable.token,
      set: { data: { userId: staffUser.id, role: userRoleIdMap.app_admin } },
    });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}/api`;
});

afterEach(async () => {
  for (const eventId of createdEventIds) {
    await db
      .delete(registrationsTable)
      .where(
        and(
          eq(registrationsTable.eventId, eventId),
          eq(registrationsTable.eventType, "rotating"),
        ),
      );
    await db.delete(eventsRotatingTable).where(eq(eventsRotatingTable.id, eventId));
  }
  for (const duprId of createdMemberIds) {
    await db.delete(membersTable).where(eq(membersTable.duprId, duprId));
  }
  for (const email of createdEmails) {
    await db
      .delete(emailVerificationCodesTable)
      .where(eq(emailVerificationCodesTable.email, email.toLowerCase()));
  }
  createdEventIds.length = 0;
  for (const eventId of createdFixedEventIds) {
    await db
      .delete(registrationsTable)
      .where(
        and(
          eq(registrationsTable.eventId, eventId),
          eq(registrationsTable.eventType, "fixed_partner"),
        ),
      );
    await db.delete(eventsFixedTable).where(eq(eventsFixedTable.id, eventId));
  }
  createdFixedEventIds.length = 0;
  createdMemberIds.length = 0;
  createdEmails.length = 0;
});

after(async () => {
  await db.delete(sessionsTable).where(eq(sessionsTable.token, STAFF_TOKEN));
  for (const userId of createdUserIds) {
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Release the pooled DB connections so the test process can exit cleanly.
  await pool.end();
});

describe("public rotating self-rating registration validation", () => {
  it("accepts an in-range numeric self-rating and stores it in the snapshot", async () => {
    const event = await createEvent({
      ratingTypeRequired: "self_numeric",
      ratingConfig: { min: 3, max: 4.5 },
    });
    const player = await createMember({ doubles: "4.00" });

    const result = await registerPublic(event.id, player.email!, {
      selfRating: "3.75",
    });

    assert.equal(result.status, 201);
    const rows = await memberRows(event.id, player.duprId);
    assert.equal(rows.length, 1);
    assert.equal((rows[0].playerSnapshot as any).selfRating, "3.75");
  });

  it("rejects missing and out-of-range numeric self-ratings", async () => {
    const event = await createEvent({
      ratingTypeRequired: "self_numeric",
      ratingConfig: { min: 3, max: 4.5 },
    });
    const missingPlayer = await createMember({ doubles: "4.00" });
    const lowPlayer = await createMember({ doubles: "4.00" });
    const highPlayer = await createMember({ doubles: "4.00" });

    const missing = await registerPublic(event.id, missingPlayer.email!);
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /Self-rating is required/);

    const tooLow = await registerPublic(event.id, lowPlayer.email!, {
      selfRating: "2.99",
    });
    assert.equal(tooLow.status, 400);
    assert.match(tooLow.body.error, /between 3\.0 and 4\.5/);

    const tooHigh = await registerPublic(event.id, highPlayer.email!, {
      selfRating: "4.51",
    });
    assert.equal(tooHigh.status, 400);
    assert.match(tooHigh.body.error, /between 3\.0 and 4\.5/);
  });

  it("accepts an in-range skill-level self-rating and stores it in the snapshot", async () => {
    const event = await createEvent({
      ratingTypeRequired: "self_skill",
      ratingConfig: { minLevel: 2, maxLevel: 4 },
    });
    const player = await createMember({ doubles: "4.00" });

    const result = await registerPublic(event.id, player.email!, {
      selfRating: "3",
    });

    assert.equal(result.status, 201);
    const rows = await memberRows(event.id, player.duprId);
    assert.equal(rows.length, 1);
    assert.equal((rows[0].playerSnapshot as any).selfRating, "3");
  });

  it("rejects missing and out-of-range skill-level self-ratings", async () => {
    const event = await createEvent({
      ratingTypeRequired: "self_skill",
      ratingConfig: { minLevel: 2, maxLevel: 4 },
    });
    const missingPlayer = await createMember({ doubles: "4.00" });
    const lowPlayer = await createMember({ doubles: "4.00" });
    const highPlayer = await createMember({ doubles: "4.00" });

    const missing = await registerPublic(event.id, missingPlayer.email!);
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /Self-rating is required/);

    const tooLow = await registerPublic(event.id, lowPlayer.email!, {
      selfRating: "1",
    });
    assert.equal(tooLow.status, 400);
    assert.match(tooLow.body.error, /skill level between 2 and 4/);

    const tooHigh = await registerPublic(event.id, highPlayer.email!, {
      selfRating: "5",
    });
    assert.equal(tooHigh.status, 400);
    assert.match(tooHigh.body.error, /skill level between 2 and 4/);
  });
});

describe("create-registration: cancelled player re-registration", () => {
  it("reactivates a cancelled registration in place rather than inserting a new row", async () => {
    const ev = await createEvent();
    const m = await createMember();
    const cancelled = await insertReg(ev.id, m.duprId, "cancelled");

    const { status, body } = await register(ev.id, m.duprId);

    assert.equal(status, 201);
    // Reactivation happens in place: same primary key, not a fresh insert.
    assert.equal(body.id, cancelled.id);
    assert.equal(body.status, "confirmed");

    const rows = await memberRows(ev.id, m.duprId);
    assert.equal(rows.length, 1, "no duplicate registration row should be created");
    assert.equal(rows[0].status, "confirmed");
    assert.equal(rows[0].cancelledAt, null, "cancellation metadata should be cleared");
    assert.equal(rows[0].cancelledBy, null);
  });

  it("picks the most recent cancelled row when several exist and reactivates only it", async () => {
    const ev = await createEvent();
    const m = await createMember();
    const older = await insertReg(ev.id, m.duprId, "cancelled");
    const newer = await insertReg(ev.id, m.duprId, "cancelled");

    const { status, body } = await register(ev.id, m.duprId);

    assert.equal(status, 201);
    assert.equal(body.id, newer.id, "the latest cancelled row is reactivated");

    const rows = await memberRows(ev.id, m.duprId);
    assert.equal(rows.length, 2, "the other cancelled row remains untouched");
    const olderRow = rows.find((r) => r.id === older.id);
    assert.equal(olderRow?.status, "cancelled");
  });
});

describe("create-registration: duplicate active sign-ups are blocked", () => {
  for (const activeStatus of ["confirmed", "waitlisted", "pending_approval"] as const) {
    it(`blocks a player who already has a ${activeStatus} registration`, async () => {
      const ev = await createEvent();
      const m = await createMember();
      await insertReg(ev.id, m.duprId, activeStatus);

      const { status } = await register(ev.id, m.duprId);

      assert.equal(status, 409);
      const rows = await memberRows(ev.id, m.duprId);
      assert.equal(rows.length, 1, "no extra row should be created on a blocked signup");
      assert.equal(rows[0].status, activeStatus);
    });
  }

  it("blocks the mixed case: a player with both a cancelled and an active row", async () => {
    const ev = await createEvent();
    const m = await createMember();
    const cancelled = await insertReg(ev.id, m.duprId, "cancelled");
    const active = await insertReg(ev.id, m.duprId, "confirmed");

    const { status } = await register(ev.id, m.duprId);

    assert.equal(status, 409);

    const rows = await memberRows(ev.id, m.duprId);
    assert.equal(rows.length, 2, "no row should be added or removed");
    const cancelledRow = rows.find((r) => r.id === cancelled.id);
    const activeRow = rows.find((r) => r.id === active.id);
    assert.equal(
      cancelledRow?.status,
      "cancelled",
      "cancelled row must NOT be reactivated while an active row exists",
    );
    assert.equal(activeRow?.status, "confirmed");
  });
});

describe("create-registration: reactivation status depends on event settings", () => {
  it("lands as confirmed when there is open capacity and no approval required", async () => {
    const ev = await createEvent({ maxParticipants: 16, requireApproval: "none" });
    const m = await createMember();
    await insertReg(ev.id, m.duprId, "cancelled");

    const { status, body } = await register(ev.id, m.duprId);

    assert.equal(status, 201);
    assert.equal(body.status, "confirmed");
  });

  it("lands as waitlisted when the event is full and the waitlist is enabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: true });
    // Fill the single confirmed slot with a different member.
    const filler = await createMember();
    await insertReg(ev.id, filler.duprId, "confirmed");

    const m = await createMember();
    const cancelled = await insertReg(ev.id, m.duprId, "cancelled");

    const { status, body } = await register(ev.id, m.duprId);

    assert.equal(status, 201);
    assert.equal(body.id, cancelled.id);
    assert.equal(body.status, "waitlisted");
  });

  it("lands as pending_approval when the event requires approval for all", async () => {
    const ev = await createEvent({ requireApproval: "all" });
    const m = await createMember();
    const cancelled = await insertReg(ev.id, m.duprId, "cancelled");

    const { status, body } = await register(ev.id, m.duprId);

    assert.equal(status, 201);
    assert.equal(body.id, cancelled.id);
    assert.equal(body.status, "pending_approval");
  });

  it("rejects reactivation without mutating the cancelled row when the event is full and the waitlist is disabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: false });
    const filler = await createMember();
    await insertReg(ev.id, filler.duprId, "confirmed");

    const m = await createMember();
    const cancelled = await insertReg(ev.id, m.duprId, "cancelled");

    const { status } = await register(ev.id, m.duprId);

    assert.equal(status, 400);
    const rows = await memberRows(ev.id, m.duprId);
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].status,
      "cancelled",
      "a rejected reactivation must leave the cancelled row unchanged",
    );
    assert.equal(rows[0].id, cancelled.id);
  });
});

describe("create-registration: concurrent rotating-event capacity", () => {
  it("confirms only one concurrent signup and waitlists the other when waitlisting is enabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: true });
    const first = await createMember();
    const second = await createMember();

    const results = await Promise.all([
      register(ev.id, first.duprId),
      register(ev.id, second.duprId),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [201, 201],
    );
    assert.deepEqual(
      results.map((result) => result.body.status).sort(),
      ["confirmed", "waitlisted"],
    );

    const rows = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
  });

  it("accepts only one concurrent signup when waitlisting is disabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: false });
    const first = await createMember();
    const second = await createMember();

    const results = await Promise.all([
      register(ev.id, first.duprId),
      register(ev.id, second.duprId),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [201, 400],
    );

    const rows = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "confirmed");
  });
});

describe("approve-registration: concurrent rotating-event capacity", () => {
  it("confirms only one concurrent approval and waitlists the other when waitlisting is enabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: true });
    const first = await createMember();
    const second = await createMember();
    const firstReg = await insertReg(ev.id, first.duprId, "pending_approval");
    const secondReg = await insertReg(ev.id, second.duprId, "pending_approval");

    const results = await Promise.all([
      approve(ev.id, firstReg.id),
      approve(ev.id, secondReg.id),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 200],
    );
    assert.deepEqual(
      results.map((result) => result.body.status).sort(),
      ["confirmed", "waitlisted"],
    );

    const rows = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
    assert.equal(rows.filter((row) => row.status === "waitlisted").length, 1);
  });

  it("approves only one concurrent registration when waitlisting is disabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: false });
    const first = await createMember();
    const second = await createMember();
    const firstReg = await insertReg(ev.id, first.duprId, "pending_approval");
    const secondReg = await insertReg(ev.id, second.duprId, "pending_approval");

    const results = await Promise.all([
      approve(ev.id, firstReg.id),
      approve(ev.id, secondReg.id),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 400],
    );

    const rows = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
    assert.equal(rows.filter((row) => row.status === "pending_approval").length, 1);
  });
});

describe("mixed signup and approval: concurrent rotating-event capacity", () => {
  it("confirms only one competitor and waitlists the other when waitlisting is enabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: true });
    const pendingPlayer = await createMember();
    const newPlayer = await createMember();
    const pendingReg = await insertReg(ev.id, pendingPlayer.duprId, "pending_approval");

    const results = await Promise.all([
      register(ev.id, newPlayer.duprId),
      approve(ev.id, pendingReg.id),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 201],
    );
    assert.deepEqual(
      results.map((result) => result.body.status).sort(),
      ["confirmed", "waitlisted"],
    );

    const rows = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
    assert.equal(
      rows.filter((row) => row.status === "confirmed").length,
      1,
      "mixed signup and approval must never exceed maxParticipants",
    );
    assert.equal(rows.filter((row) => row.status === "waitlisted").length, 1);
  });

  it("accepts only one competitor when waitlisting is disabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: false });
    const pendingPlayer = await createMember();
    const newPlayer = await createMember();
    const pendingReg = await insertReg(ev.id, pendingPlayer.duprId, "pending_approval");

    const results = await Promise.all([
      register(ev.id, newPlayer.duprId),
      approve(ev.id, pendingReg.id),
    ]);

    assert.ok(
      [[201, 400], [400, 200]].some(([signupStatus, approvalStatus]) =>
        results[0].status === signupStatus && results[1].status === approvalStatus,
      ),
      "exactly one of the concurrent operations should succeed",
    );

    const rows = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
    assert.equal(
      rows.filter((row) => row.status === "confirmed").length,
      1,
      "mixed signup and approval must never exceed maxParticipants",
    );
    assert.equal(
      rows.filter((row) => row.status === "pending_approval").length,
      results[1].status === 400 ? 1 : 0,
    );
    assert.equal(
      rows.filter((row) => row.memberDuprId === newPlayer.duprId).length,
      results[0].status === 201 ? 1 : 0,
    );
  });
});

describe("rotating roster edits: capacity decisions", () => {
  it("waitlists a promotion when the event is full and waitlisting is enabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: true });
    const filler = await createMember();
    await insertReg(ev.id, filler.duprId, "confirmed");
    const player = await createMember();
    const pending = await insertReg(ev.id, player.duprId, "pending_approval");

    const result = await editRegistration(ev.id, pending.id, { status: "confirmed" });

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "waitlisted");
    const rows = await memberRows(ev.id, player.duprId);
    assert.equal(rows[0].status, "waitlisted");
  });

  it("rejects a promotion when the event is full and waitlisting is disabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: false });
    const filler = await createMember();
    await insertReg(ev.id, filler.duprId, "confirmed");
    const player = await createMember();
    const pending = await insertReg(ev.id, player.duprId, "pending_approval");

    const result = await editRegistration(ev.id, pending.id, { status: "confirmed" });

    assert.equal(result.status, 400);
    const rows = await memberRows(ev.id, player.duprId);
    assert.equal(rows[0].status, "pending_approval");
  });

  it("allows an edit to an already confirmed registration at a full event", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: false });
    const player = await createMember();
    const confirmed = await insertReg(ev.id, player.duprId, "confirmed");

    const result = await editRegistration(ev.id, confirmed.id, { eventRole: "captain" });

    assert.equal(result.status, 200);
    assert.equal(result.body.status, "confirmed");
    assert.equal(result.body.eventRole, "captain");
  });
});

describe("rotating roster edits: concurrent promotions", () => {
  it("confirms one promotion and waitlists the other when waitlisting is enabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: true });
    const first = await createMember();
    const second = await createMember();
    const firstReg = await insertReg(ev.id, first.duprId, "pending_approval");
    const secondReg = await insertReg(ev.id, second.duprId, "pending_approval");

    const results = await Promise.all([
      editRegistration(ev.id, firstReg.id, { status: "confirmed" }),
      editRegistration(ev.id, secondReg.id, { status: "confirmed" }),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 200],
    );
    assert.deepEqual(
      results.map((result) => result.body.status).sort(),
      ["confirmed", "waitlisted"],
    );

    const rows = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
    assert.equal(rows.filter((row) => row.status === "waitlisted").length, 1);
  });

  it("accepts one promotion and rejects the other when waitlisting is disabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: false });
    const first = await createMember();
    const second = await createMember();
    const firstReg = await insertReg(ev.id, first.duprId, "pending_approval");
    const secondReg = await insertReg(ev.id, second.duprId, "pending_approval");

    const results = await Promise.all([
      editRegistration(ev.id, firstReg.id, { status: "confirmed" }),
      editRegistration(ev.id, secondReg.id, { status: "confirmed" }),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 400],
    );

    const rows = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
    assert.equal(rows.filter((row) => row.status === "pending_approval").length, 1);
  });
});

describe("mixed roster edit and signup: concurrent rotating-event capacity", () => {
  it("confirms only one competitor and waitlists the other", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: true });
    const pendingPlayer = await createMember();
    const newPlayer = await createMember();
    const pendingReg = await insertReg(ev.id, pendingPlayer.duprId, "pending_approval");

    const results = await Promise.all([
      editRegistration(ev.id, pendingReg.id, { status: "confirmed" }),
      register(ev.id, newPlayer.duprId),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 201],
    );
    assert.deepEqual(
      results.map((result) => result.body.status).sort(),
      ["confirmed", "waitlisted"],
    );

    const rows = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
  });

  it("accepts only one competitor when waitlisting is disabled", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: false });
    const pendingPlayer = await createMember();
    const newPlayer = await createMember();
    const pendingReg = await insertReg(ev.id, pendingPlayer.duprId, "pending_approval");

    const results = await Promise.all([
      editRegistration(ev.id, pendingReg.id, { status: "confirmed" }),
      register(ev.id, newPlayer.duprId),
    ]);

    assert.ok(
      [[200, 400], [400, 201]].some(([editStatus, signupStatus]) =>
        results[0].status === editStatus && results[1].status === signupStatus,
      ),
      "exactly one of the concurrent operations should succeed",
    );

    const rows = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
    assert.equal(
      rows.find((row) => row.id === pendingReg.id)?.status,
      results[0].status === 200 ? "confirmed" : "pending_approval",
    );
  });
});

describe("mixed roster edit and approval: concurrent rotating-event capacity", () => {
  it("confirms only one competitor and waitlists the other", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: true });
    const pendingEditPlayer = await createMember();
    const pendingApprovalPlayer = await createMember();
    const editReg = await insertReg(ev.id, pendingEditPlayer.duprId, "pending_approval");
    const approvalReg = await insertReg(ev.id, pendingApprovalPlayer.duprId, "pending_approval");

    const results = await Promise.all([
      editRegistration(ev.id, editReg.id, { status: "confirmed" }),
      approve(ev.id, approvalReg.id),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 200],
    );
    assert.deepEqual(
      results.map((result) => result.body.status).sort(),
      ["confirmed", "waitlisted"],
    );

    const rows = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
  });
});

describe("mixed rotating capacity operations", () => {
  for (const waitlistEnabled of [true, false]) {
    it(`never exceeds maxParticipants when signup, approval, and roster edit race with waitlisting ${waitlistEnabled ? "enabled" : "disabled"}`, async () => {
      const ev = await createEvent({ maxParticipants: 1, waitlistEnabled });
      const signupPlayer = await createMember();
      const approvalPlayer = await createMember();
      const editPlayer = await createMember();
      const approvalReg = await insertReg(ev.id, approvalPlayer.duprId, "pending_approval");
      const editReg = await insertReg(ev.id, editPlayer.duprId, "pending_approval");

      const results = await Promise.all([
        register(ev.id, signupPlayer.duprId),
        approve(ev.id, approvalReg.id),
        editRegistration(ev.id, editReg.id, { status: "confirmed" }),
      ]);

      if (waitlistEnabled) {
        assert.deepEqual(
          results.map((result) => result.status).sort((a, b) => a - b),
          [200, 200, 201],
        );
        assert.deepEqual(
          results.map((result) => result.body.status).sort(),
          ["confirmed", "waitlisted", "waitlisted"],
        );
      } else {
        assert.equal(
          results.filter((result) => result.status === 400).length,
          2,
          "the two losing operations should receive the full-event response",
        );
        assert.equal(
          results.filter((result) => result.status === 200 || result.status === 201).length,
          1,
          "exactly one operation should claim the only participant slot",
        );
      }

      const rows = await db
        .select()
        .from(registrationsTable)
        .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
      assert.equal(
        rows.filter((row) => row.status === "confirmed").length,
        1,
        "shared event-scoped capacity locking must prevent overbooking",
      );
      assert.ok(
        rows.filter((row) => row.status === "confirmed").length <= ev.maxParticipants,
        "confirmed participants must stay within maxParticipants",
      );

      if (waitlistEnabled) {
        assert.equal(rows.filter((row) => row.status === "waitlisted").length, 2);
      } else {
        assert.equal(
          rows.some((row) => row.id === approvalReg.id && row.status === "pending_approval"),
          results[1].status === 400,
        );
        assert.equal(
          rows.some((row) => row.id === editReg.id && row.status === "pending_approval"),
          results[2].status === 400,
        );
        assert.equal(
          rows.some((row) => row.memberDuprId === signupPlayer.duprId),
          results[0].status === 201,
        );
      }
    });
  }
});

describe("promote-from-waitlist: concurrent rotating-event capacity", () => {
  for (const waitlistEnabled of [true, false]) {
    it(`promotes only one registration when waitlisting is ${waitlistEnabled ? "enabled" : "disabled"}`, async () => {
      const ev = await createEvent({ maxParticipants: 1, waitlistEnabled });
      const first = await createMember();
      const second = await createMember();
      const firstReg = await insertReg(ev.id, first.duprId, "waitlisted");
      const secondReg = await insertReg(ev.id, second.duprId, "waitlisted");

      const results = await Promise.all([
        promote(ev.id, firstReg.id),
        promote(ev.id, secondReg.id),
      ]);

      assert.deepEqual(
        results.map((result) => result.status).sort((a, b) => a - b),
        [200, 400],
      );

      const rows = await db
        .select()
        .from(registrationsTable)
        .where(and(eq(registrationsTable.eventId, ev.id), eq(registrationsTable.eventType, "rotating")));
      assert.equal(
        rows.filter((row) => row.status === "confirmed").length,
        1,
        "concurrent promotions must never exceed maxParticipants",
      );
      assert.equal(rows.filter((row) => row.status === "waitlisted").length, 1);
    });
  }

  it("leaves waitlisted registrations unchanged while an event remains full", async () => {
    const ev = await createEvent({ maxParticipants: 1, waitlistEnabled: true });
    const filler = await createMember();
    await insertReg(ev.id, filler.duprId, "confirmed");
    const player = await createMember();
    const waitlisted = await insertReg(ev.id, player.duprId, "waitlisted");

    const result = await promote(ev.id, waitlisted.id);

    assert.equal(result.status, 400);
    assert.match(result.body.error, /Event is still full/);
    const rows = await memberRows(ev.id, player.duprId);
    assert.equal(rows[0].status, "waitlisted");
  });
});

describe("promote-from-waitlist: concurrent fixed-partner capacity", () => {
  for (const waitlistEnabled of [true, false]) {
    it(`promotes only one team when waitlisting is ${waitlistEnabled ? "enabled" : "disabled"}`, async () => {
      const ev = await createFixedEvent({ maxTeams: 1, waitlistEnabled });
      const firstPrimary = await createMember();
      const firstPartner = await createMember();
      const secondPrimary = await createMember();
      const secondPartner = await createMember();
      const firstReg = await insertReg(
        ev.id,
        firstPrimary.duprId,
        "waitlisted",
        { partnerDuprId: firstPartner.duprId },
        "fixed_partner",
      );
      const secondReg = await insertReg(
        ev.id,
        secondPrimary.duprId,
        "waitlisted",
        { partnerDuprId: secondPartner.duprId },
        "fixed_partner",
      );

      const results = await Promise.all([
        promote(ev.id, firstReg.id, "fixed_partner"),
        promote(ev.id, secondReg.id, "fixed_partner"),
      ]);

      assert.deepEqual(
        results.map((result) => result.status).sort((a, b) => a - b),
        [200, 400],
      );

      const rows = await db
        .select()
        .from(registrationsTable)
        .where(
          and(
            eq(registrationsTable.eventId, ev.id),
            eq(registrationsTable.eventType, "fixed_partner"),
          ),
        );
      assert.equal(
        rows.filter((row) => row.status === "confirmed").length,
        1,
        "concurrent fixed-partner promotions must never exceed maxTeams",
      );
      assert.equal(rows.filter((row) => row.status === "waitlisted").length, 1);
    });
  }
});

describe("mixed fixed-partner capacity operations", () => {
  for (const waitlistEnabled of [true, false]) {
    it(`never accepts more than one team when signup, approval, and promotion race with waitlisting ${waitlistEnabled ? "enabled" : "disabled"}`, async () => {
      const ev = await createFixedEvent({ maxTeams: 1, waitlistEnabled });
      const approvalPrimary = await createMember();
      const approvalPartner = await createMember();
      const promotionPrimary = await createMember();
      const promotionPartner = await createMember();
      const signupPrimary = await createMember();
      const signupPartner = await createMember();
      const approvalReg = await insertReg(
        ev.id,
        approvalPrimary.duprId,
        "pending_approval",
        { partnerDuprId: approvalPartner.duprId },
        "fixed_partner",
      );
      const promotionReg = await insertReg(
        ev.id,
        promotionPrimary.duprId,
        "waitlisted",
        { partnerDuprId: promotionPartner.duprId },
        "fixed_partner",
      );

      const results = await Promise.all([
        registerFixed(ev.id, signupPrimary.duprId, signupPartner.duprId),
        approve(ev.id, approvalReg.id, "fixed_partner"),
        promote(ev.id, promotionReg.id, "fixed_partner"),
      ]);

      assert.equal(
        results.filter(
          (result) =>
            (result.status === 201 && result.body.status === "confirmed") ||
            (result.status === 200 && result.body.status === "confirmed"),
        ).length,
        1,
        "exactly one operation should claim the only team slot",
      );
      assert.equal(
        results.filter((result) => result.status === 400).length,
        waitlistEnabled ? 1 : 2,
        "full-event operations should return the correct response",
      );

      const rows = await db
        .select()
        .from(registrationsTable)
        .where(
          and(
            eq(registrationsTable.eventId, ev.id),
            eq(registrationsTable.eventType, "fixed_partner"),
          ),
        );
      assert.equal(
        rows.filter((row) => row.status === "confirmed").length,
        1,
        "mixed fixed-partner operations must never exceed maxTeams",
      );
      assert.ok(
        rows.filter((row) => row.status === "confirmed").length <= ev.maxTeams,
        "confirmed teams must stay within maxTeams",
      );
      if (waitlistEnabled) {
        assert.equal(rows.filter((row) => row.status === "waitlisted").length, 2);
      } else {
        assert.equal(
          rows.some((row) => row.id === approvalReg.id && row.status === "pending_approval"),
          results[1].status === 400,
        );
        assert.equal(
          rows.some((row) => row.memberDuprId === signupPrimary.duprId),
          results[0].status === 201,
        );
        assert.equal(
          rows.some((row) => row.id === promotionReg.id && row.status === "waitlisted"),
          results[2].status === 400,
        );
      }
    });
  }
});

describe("fixed-partner roster edits: capacity decisions", () => {
  for (const waitlistEnabled of [true, false]) {
    it(`waitlists or rejects a full-event promotion when waitlisting is ${waitlistEnabled ? "enabled" : "disabled"}`, async () => {
      const ev = await createFixedEvent({ maxTeams: 1, waitlistEnabled });
      const fillerPrimary = await createMember();
      const fillerPartner = await createMember();
      await insertReg(
        ev.id,
        fillerPrimary.duprId,
        "confirmed",
        { partnerDuprId: fillerPartner.duprId },
        "fixed_partner",
      );
      const playerPrimary = await createMember();
      const playerPartner = await createMember();
      const pending = await insertReg(
        ev.id,
        playerPrimary.duprId,
        "pending_approval",
        { partnerDuprId: playerPartner.duprId },
        "fixed_partner",
      );

      const result = await editRegistration(
        ev.id,
        pending.id,
        { status: "confirmed" },
        "fixed_partner",
      );

      assert.equal(result.status, waitlistEnabled ? 200 : 400);
      const rows = await db
        .select()
        .from(registrationsTable)
        .where(
          and(
            eq(registrationsTable.eventId, ev.id),
            eq(registrationsTable.eventType, "fixed_partner"),
          ),
        );
      assert.equal(
        rows.find((row) => row.id === pending.id)?.status,
        waitlistEnabled ? "waitlisted" : "pending_approval",
      );
      assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
    });
  }
});

describe("mixed fixed-partner roster edit capacity operations", () => {
  it("serializes a roster edit with a signup", async () => {
    const ev = await createFixedEvent({ maxTeams: 1, waitlistEnabled: true });
    const editPrimary = await createMember();
    const editPartner = await createMember();
    const signupPrimary = await createMember();
    const signupPartner = await createMember();
    const editReg = await insertReg(
      ev.id,
      editPrimary.duprId,
      "pending_approval",
      { partnerDuprId: editPartner.duprId },
      "fixed_partner",
    );

    const results = await Promise.all([
      editRegistration(ev.id, editReg.id, { status: "confirmed" }, "fixed_partner"),
      registerFixed(ev.id, signupPrimary.duprId, signupPartner.duprId),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 201],
    );
    assert.deepEqual(
      results.map((result) => result.body.status).sort(),
      ["confirmed", "waitlisted"],
    );
    const rows = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.eventId, ev.id),
          eq(registrationsTable.eventType, "fixed_partner"),
        ),
      );
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
  });

  it("serializes a roster edit with approval", async () => {
    const ev = await createFixedEvent({ maxTeams: 1, waitlistEnabled: true });
    const editPrimary = await createMember();
    const editPartner = await createMember();
    const approvalPrimary = await createMember();
    const approvalPartner = await createMember();
    const editReg = await insertReg(
      ev.id,
      editPrimary.duprId,
      "pending_approval",
      { partnerDuprId: editPartner.duprId },
      "fixed_partner",
    );
    const approvalReg = await insertReg(
      ev.id,
      approvalPrimary.duprId,
      "pending_approval",
      { partnerDuprId: approvalPartner.duprId },
      "fixed_partner",
    );

    const results = await Promise.all([
      editRegistration(ev.id, editReg.id, { status: "confirmed" }, "fixed_partner"),
      approve(ev.id, approvalReg.id, "fixed_partner"),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 200],
    );
    assert.deepEqual(
      results.map((result) => result.body.status).sort(),
      ["confirmed", "waitlisted"],
    );
    const rows = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.eventId, ev.id),
          eq(registrationsTable.eventType, "fixed_partner"),
        ),
      );
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
  });

  it("serializes a roster edit with waitlist promotion", async () => {
    const ev = await createFixedEvent({ maxTeams: 1, waitlistEnabled: true });
    const editPrimary = await createMember();
    const editPartner = await createMember();
    const promotionPrimary = await createMember();
    const promotionPartner = await createMember();
    const editReg = await insertReg(
      ev.id,
      editPrimary.duprId,
      "pending_approval",
      { partnerDuprId: editPartner.duprId },
      "fixed_partner",
    );
    const promotionReg = await insertReg(
      ev.id,
      promotionPrimary.duprId,
      "waitlisted",
      { partnerDuprId: promotionPartner.duprId },
      "fixed_partner",
    );

    const results = await Promise.all([
      editRegistration(ev.id, editReg.id, { status: "confirmed" }, "fixed_partner"),
      promote(ev.id, promotionReg.id, "fixed_partner"),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 200],
    );
    assert.deepEqual(
      results.map((result) => result.body.status).sort(),
      ["confirmed", "waitlisted"],
    );
    const rows = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.eventId, ev.id),
          eq(registrationsTable.eventType, "fixed_partner"),
        ),
      );
    assert.equal(rows.filter((row) => row.status === "confirmed").length, 1);
  });
});

describe("fixed-partner event limit updates", () => {
  it("accepts equal minimum and maximum team limits", async () => {
    const ev = await createFixedEvent({ minTeams: 2, maxTeams: 8 });

    const result = await updateFixedEvent(ev.id, { minTeams: 6, maxTeams: 6 });

    assert.equal(result.status, 200);
    assert.equal(result.body.minTeams, 6);
    assert.equal(result.body.maxTeams, 6);
  });

  it("rejects negative and fractional team limits without changing the event", async () => {
    const ev = await createFixedEvent({ minTeams: 2, maxTeams: 8 });

    for (const [field, value] of [
      ["minTeams", -1],
      ["maxTeams", 2.5],
    ] as const) {
      const result = await updateFixedEvent(ev.id, { [field]: value });

      assert.equal(result.status, 400);
      assert.equal(result.body.error, `${field} must be an integer >= 1`);
    }

    const [unchanged] = await db
      .select({
        minTeams: eventsFixedTable.minTeams,
        maxTeams: eventsFixedTable.maxTeams,
      })
      .from(eventsFixedTable)
      .where(eq(eventsFixedTable.id, ev.id));
    assert.deepEqual(unchanged, { minTeams: 2, maxTeams: 8 });
  });

  it("rejects a minimum team limit above the existing maximum", async () => {
    const ev = await createFixedEvent({ minTeams: 2, maxTeams: 8 });

    const result = await updateFixedEvent(ev.id, { minTeams: 9 });

    assert.equal(result.status, 400);
    assert.equal(
      result.body.error,
      "Cannot set the minimum team limit to 9: it cannot exceed the maximum team limit of 8.",
    );
    const [unchanged] = await db
      .select({
        minTeams: eventsFixedTable.minTeams,
        maxTeams: eventsFixedTable.maxTeams,
      })
      .from(eventsFixedTable)
      .where(eq(eventsFixedTable.id, ev.id));
    assert.deepEqual(unchanged, { minTeams: 2, maxTeams: 8 });
  });

  it("rejects combined team-limit edits when the requested range is impossible", async () => {
    const ev = await createFixedEvent({ minTeams: 2, maxTeams: 8 });

    const result = await updateFixedEvent(ev.id, { minTeams: 7, maxTeams: 6 });

    assert.equal(result.status, 400);
    assert.equal(
      result.body.error,
      "Cannot set the minimum team limit to 7: it cannot exceed the maximum team limit of 6.",
    );
    const [unchanged] = await db
      .select({
        minTeams: eventsFixedTable.minTeams,
        maxTeams: eventsFixedTable.maxTeams,
      })
      .from(eventsFixedTable)
      .where(eq(eventsFixedTable.id, ev.id));
    assert.deepEqual(unchanged, { minTeams: 2, maxTeams: 8 });
  });

  it("rejects lowering maxTeams below the current confirmed-team count", async () => {
    const ev = await createFixedEvent({ maxTeams: 3 });
    const firstPrimary = await createMember();
    const firstPartner = await createMember();
    const secondPrimary = await createMember();
    const secondPartner = await createMember();
    await insertReg(
      ev.id,
      firstPrimary.duprId,
      "confirmed",
      { partnerDuprId: firstPartner.duprId },
      "fixed_partner",
    );
    await insertReg(
      ev.id,
      secondPrimary.duprId,
      "confirmed",
      { partnerDuprId: secondPartner.duprId },
      "fixed_partner",
    );

    const result = await updateFixedEvent(ev.id, { maxTeams: 1 });

    assert.equal(result.status, 400);
    assert.match(result.body.error, /already has 2 confirmed teams/);
    const [unchanged] = await db
      .select({ maxTeams: eventsFixedTable.maxTeams })
      .from(eventsFixedTable)
      .where(eq(eventsFixedTable.id, ev.id));
    assert.equal(unchanged.maxTeams, 3);
  });

  it("serializes concurrent limit changes against the confirmed-team count", async () => {
    const ev = await createFixedEvent({ maxTeams: 3 });
    const firstPrimary = await createMember();
    const firstPartner = await createMember();
    const secondPrimary = await createMember();
    const secondPartner = await createMember();
    await insertReg(
      ev.id,
      firstPrimary.duprId,
      "confirmed",
      { partnerDuprId: firstPartner.duprId },
      "fixed_partner",
    );
    await insertReg(
      ev.id,
      secondPrimary.duprId,
      "confirmed",
      { partnerDuprId: secondPartner.duprId },
      "fixed_partner",
    );

    const results = await Promise.all([
      updateFixedEvent(ev.id, { maxTeams: 1 }),
      updateFixedEvent(ev.id, { maxTeams: 2 }),
    ]);

    assert.deepEqual(results.map((result) => result.status).sort((a, b) => a - b), [200, 400]);
    assert.equal(results.filter((result) => result.status === 200)[0].body.maxTeams, 2);
    assert.ok(results.some((result) => result.status === 400 && /confirmed teams/.test(result.body.error)));
    const [unchanged] = await db
      .select({ maxTeams: eventsFixedTable.maxTeams })
      .from(eventsFixedTable)
      .where(eq(eventsFixedTable.id, ev.id));
    assert.equal(unchanged.maxTeams, 2);
  });
});

describe("fixed-partner event creation limits", () => {
  it("accepts equal minimum and maximum team limits", async () => {
    const result = await createFixedEventViaApi({ minTeams: 6, maxTeams: 6 });

    assert.equal(result.status, 201);
    assert.equal(result.body[0].minTeams, 6);
    assert.equal(result.body[0].maxTeams, 6);
    createdFixedEventIds.push(result.body[0].id);
  });

  it("rejects negative and fractional team limits without persisting an event", async () => {
    for (const [field, value] of [
      ["minTeams", -1],
      ["maxTeams", 2.5],
    ] as const) {
      const result = await createFixedEventViaApi({ [field]: value });

      assert.equal(result.status, 400);
      assert.equal(result.body.error, `${field} must be an integer >= 1`);
      const rows = await db
        .select({ id: eventsFixedTable.id })
        .from(eventsFixedTable)
        .where(eq(eventsFixedTable.name, result.name));
      assert.deepEqual(rows, []);
    }
  });

  it("rejects minTeams above the default maxTeams without persisting an event", async () => {
    const result = await createFixedEventViaApi({ minTeams: 9 });

    assert.equal(result.status, 400);
    assert.equal(
      result.body.error,
      "Cannot set the minimum team limit to 9: it cannot exceed the maximum team limit of 8.",
    );
    const rows = await db
      .select({ id: eventsFixedTable.id })
      .from(eventsFixedTable)
      .where(eq(eventsFixedTable.name, result.name));
    assert.deepEqual(rows, []);
  });

  it("rejects combined team limits when minTeams exceeds maxTeams without persisting an event", async () => {
    const result = await createFixedEventViaApi({ minTeams: 9, maxTeams: 8 });

    assert.equal(result.status, 400);
    assert.equal(
      result.body.error,
      "Cannot set the minimum team limit to 9: it cannot exceed the maximum team limit of 8.",
    );
    const rows = await db
      .select({ id: eventsFixedTable.id })
      .from(eventsFixedTable)
      .where(eq(eventsFixedTable.name, result.name));
    assert.deepEqual(rows, []);
  });
});

describe("rotating event creation limits", () => {
  it("accepts equal minimum and maximum participant limits", async () => {
    const result = await createRotatingEventViaApi({
      minParticipants: 12,
      maxParticipants: 12,
    });

    assert.equal(result.status, 201);
    assert.equal(result.body[0].minParticipants, 12);
    assert.equal(result.body[0].maxParticipants, 12);
    createdEventIds.push(result.body[0].id);
  });

  it("rejects negative and fractional participant limits without persisting an event", async () => {
    for (const [field, value] of [
      ["minParticipants", -1],
      ["maxParticipants", 2.5],
    ] as const) {
      const result = await createRotatingEventViaApi({ [field]: value });

      assert.equal(result.status, 400);
      assert.equal(result.body.error, `${field} must be an integer >= 1`);
      const rows = await db
        .select({ id: eventsRotatingTable.id })
        .from(eventsRotatingTable)
        .where(eq(eventsRotatingTable.name, result.name));
      assert.deepEqual(rows, []);
    }
  });

  it("rejects minParticipants above the default maxParticipants without persisting an event", async () => {
    const result = await createRotatingEventViaApi({ minParticipants: 17 });

    assert.equal(result.status, 400);
    assert.equal(
      result.body.error,
      "Cannot set the minimum participant limit to 17: it cannot exceed the maximum participant limit of 16.",
    );
    const rows = await db
      .select({ id: eventsRotatingTable.id })
      .from(eventsRotatingTable)
      .where(eq(eventsRotatingTable.name, result.name));
    assert.deepEqual(rows, []);
  });

  it("rejects combined participant limits when minParticipants exceeds maxParticipants without persisting an event", async () => {
    const result = await createRotatingEventViaApi({
      minParticipants: 17,
      maxParticipants: 16,
    });

    assert.equal(result.status, 400);
    assert.equal(
      result.body.error,
      "Cannot set the minimum participant limit to 17: it cannot exceed the maximum participant limit of 16.",
    );
    const rows = await db
      .select({ id: eventsRotatingTable.id })
      .from(eventsRotatingTable)
      .where(eq(eventsRotatingTable.name, result.name));
    assert.deepEqual(rows, []);
  });
});

describe("rotating event limit updates", () => {
  it("accepts equal minimum and maximum participant limits", async () => {
    const ev = await createEvent({ minParticipants: 2, maxParticipants: 16 });

    const result = await updateRotatingEvent(ev.id, {
      minParticipants: 8,
      maxParticipants: 8,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.minParticipants, 8);
    assert.equal(result.body.maxParticipants, 8);
  });

  it("rejects negative and fractional participant limits without changing the event", async () => {
    const ev = await createEvent({ minParticipants: 2, maxParticipants: 16 });

    for (const [field, value] of [
      ["minParticipants", -1],
      ["maxParticipants", 2.5],
    ] as const) {
      const result = await updateRotatingEvent(ev.id, { [field]: value });

      assert.equal(result.status, 400);
      assert.equal(result.body.error, `${field} must be an integer >= 1`);
    }

    const [unchanged] = await db
      .select({
        minParticipants: eventsRotatingTable.minParticipants,
        maxParticipants: eventsRotatingTable.maxParticipants,
      })
      .from(eventsRotatingTable)
      .where(eq(eventsRotatingTable.id, ev.id));
    assert.deepEqual(unchanged, { minParticipants: 2, maxParticipants: 16 });
  });

  it("accepts safe participant limit changes and preserves the event response shape", async () => {
    const ev = await createEvent({ minParticipants: 2, maxParticipants: 4 });
    const confirmed = await createMember();
    await insertReg(ev.id, confirmed.duprId, "confirmed");

    const result = await updateRotatingEvent(ev.id, {
      minParticipants: 3,
      maxParticipants: 6,
    });

    assert.equal(result.status, 200);
    assert.deepEqual(Object.keys(result.body).sort(), [
      ...Object.keys(ev),
      "maxTeams",
      "minTeams",
      "teamFormat",
    ].sort());
    assert.equal(result.body.id, ev.id);
    assert.equal(result.body.teamFormat, "rotating");
    assert.equal(result.body.minParticipants, 3);
    assert.equal(result.body.maxParticipants, 6);
    assert.equal(result.body.minTeams, null);
    assert.equal(result.body.maxTeams, null);
  });

  it("rejects a minimum participant limit above the existing maximum", async () => {
    const ev = await createEvent({ minParticipants: 4, maxParticipants: 16 });

    const result = await updateRotatingEvent(ev.id, { minParticipants: 17 });

    assert.equal(result.status, 400);
    assert.equal(
      result.body.error,
      "Cannot set the minimum participant limit to 17: it cannot exceed the maximum participant limit of 16.",
    );
    const [unchanged] = await db
      .select({
        minParticipants: eventsRotatingTable.minParticipants,
        maxParticipants: eventsRotatingTable.maxParticipants,
      })
      .from(eventsRotatingTable)
      .where(eq(eventsRotatingTable.id, ev.id));
    assert.deepEqual(unchanged, { minParticipants: 4, maxParticipants: 16 });
  });

  it("rejects contradictory participant limits without persisting either value", async () => {
    const ev = await createEvent({ minParticipants: 4, maxParticipants: 16 });

    const result = await updateRotatingEvent(ev.id, {
      minParticipants: 12,
      maxParticipants: 8,
    });

    assert.equal(result.status, 400);
    assert.equal(
      result.body.error,
      "Cannot set the minimum participant limit to 12: it cannot exceed the maximum participant limit of 8.",
    );
    const [unchanged] = await db
      .select({
        minParticipants: eventsRotatingTable.minParticipants,
        maxParticipants: eventsRotatingTable.maxParticipants,
      })
      .from(eventsRotatingTable)
      .where(eq(eventsRotatingTable.id, ev.id));
    assert.deepEqual(unchanged, { minParticipants: 4, maxParticipants: 16 });
  });

  it("rejects lowering maxParticipants below the current confirmed-participant count", async () => {
    const ev = await createEvent({ minParticipants: 1, maxParticipants: 3 });
    const first = await createMember();
    const second = await createMember();
    await insertReg(ev.id, first.duprId, "confirmed");
    await insertReg(ev.id, second.duprId, "confirmed");

    const result = await updateRotatingEvent(ev.id, { maxParticipants: 1 });

    assert.equal(result.status, 400);
    assert.match(result.body.error, /already has 2 confirmed participants/);
    const [unchanged] = await db
      .select({ maxParticipants: eventsRotatingTable.maxParticipants })
      .from(eventsRotatingTable)
      .where(eq(eventsRotatingTable.id, ev.id));
    assert.equal(unchanged.maxParticipants, 3);
  });

  it("serializes concurrent limit changes against the confirmed-participant count", async () => {
    const ev = await createEvent({ minParticipants: 1, maxParticipants: 3 });
    const first = await createMember();
    const second = await createMember();
    await insertReg(ev.id, first.duprId, "confirmed");
    await insertReg(ev.id, second.duprId, "confirmed");

    const results = await Promise.all([
      updateRotatingEvent(ev.id, { maxParticipants: 1 }),
      updateRotatingEvent(ev.id, { maxParticipants: 2 }),
    ]);

    assert.deepEqual(results.map((result) => result.status).sort((a, b) => a - b), [200, 400]);
    assert.equal(results.filter((result) => result.status === 200)[0].body.maxParticipants, 2);
    assert.ok(results.some((result) => result.status === 400 && /confirmed participants/.test(result.body.error)));
    const [unchanged] = await db
      .select({ maxParticipants: eventsRotatingTable.maxParticipants })
      .from(eventsRotatingTable)
      .where(eq(eventsRotatingTable.id, ev.id));
    assert.equal(unchanged.maxParticipants, 2);
  });
});
