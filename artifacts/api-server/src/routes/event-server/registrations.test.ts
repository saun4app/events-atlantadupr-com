import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Server, AddressInfo } from "node:net";

import { db, pool } from "@workspace/db";
import {
  registrationsTable,
  membersTable,
  eventsRotatingTable,
  sessionsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

import app from "../../app.js";

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
  await db
    .insert(sessionsTable)
    .values({ token: STAFF_TOKEN, data: { userId: -1, role: "admin" } })
    .onConflictDoUpdate({
      target: sessionsTable.token,
      set: { data: { userId: -1, role: "admin" } },
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
  createdEventIds.length = 0;
  createdMemberIds.length = 0;
});

after(async () => {
  await db.delete(sessionsTable).where(eq(sessionsTable.token, STAFF_TOKEN));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Release the pooled DB connections so the test process can exit cleanly.
  await pool.end();
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
