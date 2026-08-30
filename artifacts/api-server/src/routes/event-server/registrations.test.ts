import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Server, AddressInfo } from "node:net";

import { db, pool } from "@workspace/db";
import {
  registrationsTable,
  membersTable,
  eventsRotatingTable,
  emailVerificationCodesTable,
  sessionsTable,
  usersTable,
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
) {
  const [r] = await db
    .insert(registrationsTable)
    .values({
      eventId,
      eventType: "rotating",
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

async function approve(eventId: number, registrationId: number) {
  const res = await fetch(
    `${baseUrl}/events/rotating/${eventId}/registrations/${registrationId}/approve`,
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

async function promote(eventId: number, registrationId: number) {
  const res = await fetch(
    `${baseUrl}/events/rotating/${eventId}/registrations/${registrationId}/promote`,
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

async function editRegistration(eventId: number, registrationId: number, body: Record<string, unknown>) {
  const res = await fetch(
    `${baseUrl}/events/rotating/${eventId}/registrations/${registrationId}`,
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

before(async () => {
  const [staffUser] = await db
    .insert(usersTable)
    .values({
      name: "Test Staff",
      username: "test-staff-" + Math.random().toString(36).slice(2),
      passwordHash: "test-password-hash",
      role: "admin",
    })
    .returning();
  createdUserIds.push(staffUser.id);

  await db
    .insert(sessionsTable)
    .values({ token: STAFF_TOKEN, data: { userId: staffUser.id, role: "admin" } })
    .onConflictDoUpdate({
      target: sessionsTable.token,
      set: { data: { userId: staffUser.id, role: "admin" } },
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
