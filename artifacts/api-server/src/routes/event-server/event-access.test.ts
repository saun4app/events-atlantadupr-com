import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";

import { inArray } from "drizzle-orm";
import {
  db,
  eventAssignmentsTable,
  eventsFixedTable,
  eventsRotatingTable,
  membersTable,
  pool,
  registrationsTable,
  sessionsTable,
  userRoleIdMap,
  usersTable,
} from "@workspace/db";
import app from "../../app.js";
import { USER_ROLE_GROUPS } from "../../lib/user-roles.js";

const ASSIGNABLE_ROLES = USER_ROLE_GROUPS.assignableStaff;
const ORGANIZER_ROLE = userRoleIdMap.admin;

let server: Server;
let baseUrl: string;
const users: Array<{ id: number; role: string; token: string }> = [];
const eventIds: Array<{ id: number; eventType: "rotating" | "fixed_partner" }> = [];
const memberIds: string[] = [];

async function createRotatingEvent() {
  const now = Date.now();
  const [event] = await db
    .insert(eventsRotatingTable)
    .values({
      name: `Access test ${Math.random().toString(36).slice(2)}`,
      startDatetime: new Date(now + 86_400_000),
      endDatetime: new Date(now + 90_000_000),
      locationName: "Access Test Courts",
      signupStartDatetime: new Date(now - 86_400_000),
      signupEndDatetime: new Date(now + 86_400_000),
      status: "upcoming",
    })
    .returning();
  eventIds.push({ id: event.id, eventType: "rotating" });
  return event;
}

async function createFixedEvent() {
  const now = Date.now();
  const [event] = await db
    .insert(eventsFixedTable)
    .values({
      name: `Fixed access test ${Math.random().toString(36).slice(2)}`,
      startDatetime: new Date(now + 86_400_000),
      endDatetime: new Date(now + 90_000_000),
      locationName: "Access Test Courts",
      signupStartDatetime: new Date(now - 86_400_000),
      signupEndDatetime: new Date(now + 86_400_000),
      status: "upcoming",
    })
    .returning();
  eventIds.push({ id: event.id, eventType: "fixed_partner" });
  return event;
}

async function createMember() {
  const duprId = `ACCESS-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const [member] = await db
    .insert(membersTable)
    .values({
      duprId,
      name: "Access Test Player",
      doubles: "3.500",
      email: `${duprId.toLowerCase()}@test.local`,
    })
    .returning();
  memberIds.push(member.duprId);
  return member;
}

async function request(
  path: string,
  token: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  return { response, body: body as any };
}

before(async () => {
  for (const role of [...ASSIGNABLE_ROLES, ORGANIZER_ROLE]) {
    const [user] = await db
      .insert(usersTable)
      .values({
        name: `Access ${role}`,
        username: `access-${role}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "test-password-hash",
        role,
      })
      .returning();
    const token = `event-access-${role}-${Math.random().toString(36).slice(2)}`;
    users.push({ id: user.id, role, token });
    await db.insert(sessionsTable).values({
      token,
      data: { userId: user.id, role },
    });
  }

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

after(async () => {
  const ids = eventIds.map(({ id }) => id);
  if (ids.length > 0) {
    await db.delete(registrationsTable).where(inArray(registrationsTable.eventId, ids));
    await db.delete(eventAssignmentsTable).where(inArray(eventAssignmentsTable.eventId, ids));
    await db.delete(eventsRotatingTable).where(
      inArray(eventsRotatingTable.id, eventIds.filter((event) => event.eventType === "rotating").map((event) => event.id)),
    );
    await db.delete(eventsFixedTable).where(
      inArray(eventsFixedTable.id, eventIds.filter((event) => event.eventType === "fixed_partner").map((event) => event.id)),
    );
  }
  if (memberIds.length > 0) {
    await db.delete(membersTable).where(inArray(membersTable.duprId, memberIds));
  }
  if (users.length > 0) {
    await db.delete(sessionsTable).where(inArray(sessionsTable.token, users.map((user) => user.token)));
    await db.delete(usersTable).where(inArray(usersTable.id, users.map((user) => user.id)));
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("event assignment write access", () => {
  for (const role of ASSIGNABLE_ROLES) {
    it(`${role} can load and write an assigned event`, async () => {
      const staff = users.find((user) => user.role === role)!;
      const event = await createRotatingEvent();
      const member = await createMember();

      await db.insert(eventAssignmentsTable).values({
        userId: staff.id,
        eventId: event.id,
        eventType: "rotating",
      });

      const loaded = await request(`/events/rotating/${event.id}`, staff.token);
      assert.equal(loaded.response.status, 200);
      assert.equal(loaded.body.canWrite, true);

      const updated = await request(`/events/rotating/${event.id}`, staff.token, {
        method: "PATCH",
        body: JSON.stringify({ name: `${event.name} updated` }),
      });
      assert.equal(updated.response.status, 200);

      const registration = await request(`/events/rotating/${event.id}/registrations`, staff.token, {
        method: "POST",
        body: JSON.stringify({ memberDuprId: member.duprId }),
      });
      assert.equal(registration.response.status, 201);

      const bulk = await request(
        `/events/rotating/${event.id}/registrations/bulk-set-assigned-ratings`,
        staff.token,
        { method: "POST" },
      );
      assert.equal(bulk.response.status, 200);
    });

    it(`${role} is forbidden from writing an unassigned event`, async () => {
      const staff = users.find((user) => user.role === role)!;
      const event = await createFixedEvent();
      const member = await createMember();

      const loaded = await request(`/events/fixed_partner/${event.id}`, staff.token);
      assert.equal(loaded.response.status, 200);
      assert.equal(loaded.body.canWrite, false);

      const updated = await request(`/events/fixed_partner/${event.id}`, staff.token, {
        method: "PATCH",
        body: JSON.stringify({ name: `${event.name} should not update` }),
      });
      assert.equal(updated.response.status, 403);
      assert.equal(updated.body.error, "Forbidden: not assigned to this event");

      const registration = await request(`/events/fixed_partner/${event.id}/registrations`, staff.token, {
        method: "POST",
        body: JSON.stringify({ memberDuprId: member.duprId, partnerDuprId: member.duprId }),
      });
      assert.equal(registration.response.status, 403);
      assert.equal(registration.body.error, "Forbidden: not assigned to this event");

      const bulk = await request(
        `/events/fixed_partner/${event.id}/registrations/bulk-set-assigned-ratings`,
        staff.token,
        { method: "POST" },
      );
      assert.equal(bulk.response.status, 403);
      assert.equal(bulk.body.error, "Forbidden: not assigned to this event");
    });
  }

  it("organizers retain write access without an event assignment", async () => {
    const organizer = users.find((user) => user.role === ORGANIZER_ROLE)!;
    const event = await createFixedEvent();

    const loaded = await request(`/events/fixed_partner/${event.id}`, organizer.token);
    assert.equal(loaded.response.status, 200);
    assert.equal(loaded.body.canWrite, true);

    const updated = await request(`/events/fixed_partner/${event.id}`, organizer.token, {
      method: "PATCH",
      body: JSON.stringify({ name: `${event.name} updated by organizer` }),
    });
    assert.equal(updated.response.status, 200);
  });
});