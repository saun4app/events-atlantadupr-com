import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo, Server } from "node:net";

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  assertTestDatabase,
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
import {
  AUTHORIZATION_TEST_FIXTURE_MARKER,
  eventControllers,
  isAuthorizationTestFixture,
} from "./eventController.js";

const ASSIGNABLE_ROLES = ["club_member"];
const ORGANIZER_ROLE = userRoleIdMap.app_admin;
const ORGANIZER_ROLES = USER_ROLE_GROUPS.globalEventManagers;
const ACCESS_ROLES = [...new Set([...ASSIGNABLE_ROLES, ...ORGANIZER_ROLES])];
const FORBIDDEN_ERROR = "Forbidden: not assigned to this event";

let server: Server;
let baseUrl: string;
const users: Array<{ id: number; role: string; token: string }> = [];
const eventIds: Array<{ id: number; eventType: "rotating" | "fixed_partner" }> = [];
const clonedEventIds: Array<{ id: number; eventType: "rotating" | "fixed_partner" }> = [];
const memberIds: string[] = [];

async function createRotatingEvent() {
  const now = Date.now();
  const [event] = await db
    .insert(eventsRotatingTable)
    .values({
      name: `Access test ${Math.random().toString(36).slice(2)}`,
      description: AUTHORIZATION_TEST_FIXTURE_MARKER,
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
      description: AUTHORIZATION_TEST_FIXTURE_MARKER,
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

type EventType = "rotating" | "fixed_partner";
type WriteAction =
  | "update-event"
  | "delete-event"
  | "clone-event"
  | "close-event"
  | "broadcast"
  | "create-registration"
  | "bulk-set-assigned-ratings"
  | "edit-registration"
  | "delete-registration"
  | "approve-registration"
  | "reject-registration"
  | "promote-registration";

const WRITE_ACTIONS: WriteAction[] = [
  "update-event",
  "delete-event",
  "clone-event",
  "close-event",
  "broadcast",
  "create-registration",
  "bulk-set-assigned-ratings",
  "edit-registration",
  "delete-registration",
  "approve-registration",
  "reject-registration",
  "promote-registration",
];

async function createEvent(eventType: EventType) {
  return eventType === "rotating"
    ? createRotatingEvent()
    : createFixedEvent();
}

async function createAccessRegistration(
  eventType: EventType,
  eventId: number,
  status: "confirmed" | "waitlisted" | "pending_approval",
) {
  const member = await createMember();
  const partner = eventType === "fixed_partner" ? await createMember() : null;
  const [registration] = await db
    .insert(registrationsTable)
    .values({
      eventId,
      eventType,
      memberDuprId: member.duprId,
      partnerDuprId: partner?.duprId ?? null,
      playerSnapshot: {
        name: member.name,
        doubles: member.doubles,
        singles: member.singles,
        selfRating: member.selfRating,
        email: member.email,
        phone: member.phone,
      },
      partnerSnapshot: partner
        ? {
            partnerName: partner.name,
            partnerDoubles: partner.doubles,
            partnerSelfRating: partner.selfRating,
          }
        : null,
      status,
    })
    .returning();
  return registration;
}

async function runWriteAction(
  eventType: EventType,
  action: WriteAction,
  actor: { id: number; token: string },
  assignActor: boolean,
  eventRole = "event_captain",
) {
  const event = await createEvent(eventType);
  if (assignActor) {
    await db.insert(eventAssignmentsTable).values({
      userId: actor.id,
      eventId: event.id,
      eventType,
      eventRole,
    });
  }

  let registrationId: number | undefined;
  let response: { response: Response; body: any };
  switch (action) {
    case "update-event":
      response = await request(`/events/${eventType}/${event.id}`, actor.token, {
        method: "PATCH",
        body: JSON.stringify({ name: `${event.name} updated` }),
      });
      break;
    case "delete-event":
      response = await request(`/events/${eventType}/${event.id}`, actor.token, {
        method: "DELETE",
      });
      break;
    case "clone-event":
      response = await request(`/events/${eventType}/${event.id}/clone`, actor.token, {
        method: "POST",
        body: JSON.stringify({ name: `${event.name} clone` }),
      });
      break;
    case "close-event":
      response = await request(`/events/${eventType}/${event.id}/close`, actor.token, {
        method: "POST",
      });
      break;
    case "broadcast":
      // A valid message reaches the assignment check, then stops before any
      // external email delivery because this event has no participants.
      response = await request(`/events/${eventType}/${event.id}/broadcast`, actor.token, {
        method: "POST",
        body: JSON.stringify({ subject: "Access test", body: "Access test message" }),
      });
      break;
    case "create-registration": {
      const member = await createMember();
      const partner = eventType === "fixed_partner" ? await createMember() : null;
      response = await request(`/events/${eventType}/${event.id}/registrations`, actor.token, {
        method: "POST",
        body: JSON.stringify({
          memberDuprId: member.duprId,
          ...(partner ? { partnerDuprId: partner.duprId } : {}),
        }),
      });
      break;
    }
    case "bulk-set-assigned-ratings":
      await createAccessRegistration(eventType, event.id, "confirmed");
      response = await request(
        `/events/${eventType}/${event.id}/registrations/bulk-set-assigned-ratings`,
        actor.token,
        { method: "POST" },
      );
      break;
    case "edit-registration":
      registrationId = (await createAccessRegistration(eventType, event.id, "confirmed")).id;
      response = await request(
        `/events/${eventType}/${event.id}/registrations/${registrationId}`,
        actor.token,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "no_show" }),
        },
      );
      break;
    case "delete-registration":
      registrationId = (await createAccessRegistration(eventType, event.id, "confirmed")).id;
      response = await request(
        `/events/${eventType}/${event.id}/registrations/${registrationId}`,
        actor.token,
        { method: "DELETE" },
      );
      break;
    case "approve-registration":
      registrationId = (await createAccessRegistration(eventType, event.id, "pending_approval")).id;
      response = await request(
        `/events/${eventType}/${event.id}/registrations/${registrationId}/approve`,
        actor.token,
        { method: "POST" },
      );
      break;
    case "reject-registration":
      registrationId = (await createAccessRegistration(eventType, event.id, "pending_approval")).id;
      response = await request(
        `/events/${eventType}/${event.id}/registrations/${registrationId}/reject`,
        actor.token,
        { method: "POST" },
      );
      break;
    case "promote-registration":
      registrationId = (await createAccessRegistration(eventType, event.id, "waitlisted")).id;
      response = await request(
        `/events/${eventType}/${event.id}/registrations/${registrationId}/promote`,
        actor.token,
        { method: "POST" },
      );
      break;
  }

  if (action === "clone-event" && response.response.status === 201) {
    const clonedEventId = response.body?.id;
    assert.equal(typeof clonedEventId, "number", "clone response should include the new event ID");
    const clonedEvent = { id: clonedEventId, eventType };
    eventIds.push(clonedEvent);
    clonedEventIds.push(clonedEvent);
  }

  return response;
}

function expectedWriteStatus(action: WriteAction) {
  if (action === "broadcast") return 400;
  if (action === "delete-event" || action === "delete-registration") return 204;
  if (action === "clone-event" || action === "create-registration") return 201;
  return 200;
}

async function cleanupStaleAuthorizationFixtures(
  protectedEventKeys = new Set<string>(),
) {
  const candidates = (
    await Promise.all([
      eventControllers.rotating.allNormalized(),
      eventControllers.fixed_partner.allNormalized(),
    ])
  ).flat();
  const staleFixtures = candidates.filter(
    (event) =>
      isAuthorizationTestFixture(event) &&
      !protectedEventKeys.has(`${event.teamFormat}:${event.id}`),
  );

  await db.transaction(async (tx) => {
    for (const event of staleFixtures) {
      await tx
        .delete(registrationsTable)
        .where(
          and(
            eq(registrationsTable.eventId, event.id),
            eq(registrationsTable.eventType, event.teamFormat),
          ),
        );
      await tx
        .delete(eventAssignmentsTable)
        .where(
          and(
            eq(eventAssignmentsTable.eventId, event.id),
            eq(eventAssignmentsTable.eventType, event.teamFormat),
          ),
        );

      if (event.teamFormat === "rotating") {
        await tx.delete(eventsRotatingTable).where(eq(eventsRotatingTable.id, event.id));
      } else {
        await tx.delete(eventsFixedTable).where(eq(eventsFixedTable.id, event.id));
      }
    }
  });

  return staleFixtures;
}

before(async () => {
  await assertTestDatabase();
  await cleanupStaleAuthorizationFixtures();

  for (const role of ACCESS_ROLES) {
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
  await assertTestDatabase();
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
  const rotatingCloneIds = clonedEventIds
    .filter((event) => event.eventType === "rotating")
    .map((event) => event.id);
  if (rotatingCloneIds.length > 0) {
    const remainingRotatingClones = await db
      .select({ id: eventsRotatingTable.id })
      .from(eventsRotatingTable)
      .where(inArray(eventsRotatingTable.id, rotatingCloneIds));
    assert.deepEqual(remainingRotatingClones, []);
  }
  const fixedCloneIds = clonedEventIds
    .filter((event) => event.eventType === "fixed_partner")
    .map((event) => event.id);
  if (fixedCloneIds.length > 0) {
    const remainingFixedClones = await db
      .select({ id: eventsFixedTable.id })
      .from(eventsFixedTable)
      .where(inArray(eventsFixedTable.id, fixedCloneIds));
    assert.deepEqual(remainingFixedClones, []);
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

describe("authorization fixture cleanup", () => {
  it("removes interrupted legacy and marked fixtures but preserves unrelated events", async () => {
    const now = Date.now();
    const [legacyRotating] = await db
      .insert(eventsRotatingTable)
      .values({
        name: "Access test interruptedrun",
        startDatetime: new Date(now + 86_400_000),
        endDatetime: new Date(now + 90_000_000),
        locationName: "Access Test Courts",
        signupStartDatetime: new Date(now - 86_400_000),
        signupEndDatetime: new Date(now + 86_400_000),
        status: "upcoming",
      })
      .returning();
    const [markedFixed] = await db
      .insert(eventsFixedTable)
      .values({
        name: "Fixed access test interruptedrun",
        description: AUTHORIZATION_TEST_FIXTURE_MARKER,
        startDatetime: new Date(now + 86_400_000),
        endDatetime: new Date(now + 90_000_000),
        locationName: "Access Test Courts",
        signupStartDatetime: new Date(now - 86_400_000),
        signupEndDatetime: new Date(now + 86_400_000),
        status: "upcoming",
      })
      .returning();
    const staleRegistration = await createAccessRegistration(
      "rotating",
      legacyRotating.id,
      "confirmed",
    );
    const assignee = users.find((user) => user.role === ASSIGNABLE_ROLES[0])!;
    await db.insert(eventAssignmentsTable).values({
      userId: assignee.id,
      eventId: legacyRotating.id,
      eventType: "rotating",
      eventRole: "event_captain",
    });
    const [unrelatedEvent] = await db
      .insert(eventsRotatingTable)
      .values({
        name: "Access test event for a real tournament",
        startDatetime: new Date(now + 86_400_000),
        endDatetime: new Date(now + 90_000_000),
        locationName: "Access Test Courts",
        signupStartDatetime: new Date(now - 86_400_000),
        signupEndDatetime: new Date(now + 86_400_000),
        status: "upcoming",
      })
      .returning();
    eventIds.push({ id: unrelatedEvent.id, eventType: "rotating" });

    const cleaned = await cleanupStaleAuthorizationFixtures(
      new Set(eventIds.map((event) => `${event.eventType}:${event.id}`)),
    );

    assert.deepEqual(
      cleaned.map((event) => `${event.teamFormat}:${event.id}`),
      [`rotating:${legacyRotating.id}`, `fixed_partner:${markedFixed.id}`],
    );
    const remainingRotating = await db
      .select({ id: eventsRotatingTable.id })
      .from(eventsRotatingTable)
      .where(inArray(eventsRotatingTable.id, [legacyRotating.id, unrelatedEvent.id]));
    const remainingFixed = await db
      .select({ id: eventsFixedTable.id })
      .from(eventsFixedTable)
      .where(eq(eventsFixedTable.id, markedFixed.id));
    assert.deepEqual(
      remainingRotating.map(({ id }) => id),
      [unrelatedEvent.id],
    );
    assert.deepEqual(remainingFixed, []);
    const remainingRegistration = await db
      .select({ id: registrationsTable.id })
      .from(registrationsTable)
      .where(eq(registrationsTable.id, staleRegistration.id));
    const remainingAssignment = await db
      .select()
      .from(eventAssignmentsTable)
      .where(
        and(
          eq(eventAssignmentsTable.eventId, legacyRotating.id),
          eq(eventAssignmentsTable.eventType, "rotating"),
        ),
      );
    assert.deepEqual(remainingRegistration, []);
    assert.deepEqual(remainingAssignment, []);
  });

  it("does not classify a real event with a similar name as a fixture", () => {
    assert.equal(
      isAuthorizationTestFixture({
        teamFormat: "rotating",
        name: "Access test Saturday tournament",
        description: null,
        eventDescription: null,
        locationName: "Access Test Courts",
        locationAddress: "",
      }),
      false,
    );
  });
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
        eventRole: "event_captain",
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

  for (const eventType of ["rotating", "fixed_partner"] as const) {
    it(`an organizer assignment can write only its ${eventType} event`, async () => {
      const organizer = users.find((user) => user.role === "club_member")!;
      const result = await runWriteAction(
        eventType,
        "update-event",
        organizer,
        true,
        "event_organizer",
      );
      assert.equal(result.response.status, 200);
    });
  }

  it("an organizer assignment can manage assignments for only its event", async () => {
    const organizer = users.find((user) => user.role === "club_member")!;
    const assignee = users.find((user) => user.role === "club_director")!;
    const event = await createRotatingEvent();
    await db.insert(eventAssignmentsTable).values({
      userId: organizer.id,
      eventId: event.id,
      eventType: "rotating",
      eventRole: "event_organizer",
    });
    const added = await request(`/events/rotating/${event.id}/assignments`, organizer.token, {
      method: "POST",
      body: JSON.stringify({ userId: assignee.id, eventRole: "court_leader" }),
    });
    assert.equal(added.response.status, 201);
    assert.equal(added.body.eventRole, "court_leader");
  });

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

describe("event assignment permission matrix", () => {
  for (const role of ASSIGNABLE_ROLES) {
    for (const eventType of ["rotating", "fixed_partner"] as const) {
      it(`${role} can perform every ${eventType} write when assigned`, async () => {
        const staff = users.find((user) => user.role === role)!;

        for (const action of WRITE_ACTIONS) {
          const result = await runWriteAction(eventType, action, staff, true);
          assert.equal(
            result.response.status,
            expectedWriteStatus(action),
            `${eventType} ${action} returned ${result.response.status}: ${JSON.stringify(result.body)}`,
          );
        }
      });

      it(`${role} receives the same 403 for every unassigned ${eventType} write`, async () => {
        const staff = users.find((user) => user.role === role)!;

        for (const action of WRITE_ACTIONS) {
          const result = await runWriteAction(eventType, action, staff, false);
          assert.equal(result.response.status, 403, `${eventType} ${action}`);
          assert.equal(result.body?.error, FORBIDDEN_ERROR, `${eventType} ${action}`);
        }
      });
    }
  }

  for (const role of ORGANIZER_ROLES) {
    for (const eventType of ["rotating", "fixed_partner"] as const) {
      it(`${role} retains every ${eventType} write without an assignment`, async () => {
        const organizer = users.find((user) => user.role === role)!;

        for (const action of WRITE_ACTIONS) {
          const result = await runWriteAction(eventType, action, organizer, false);
          assert.equal(
            result.response.status,
            expectedWriteStatus(action),
            `${eventType} ${action} returned ${result.response.status}: ${JSON.stringify(result.body)}`,
          );
        }
      });
    }
  }
});

describe("event assignment management access", () => {
  for (const role of ORGANIZER_ROLES) {
    for (const eventType of ["rotating", "fixed_partner"] as const) {
      it(`${role} can list, add, and remove ${eventType} assignments without crossing formats`, async () => {
        const organizer = users.find((user) => user.role === role)!;
        const assignee = users.find((user) => user.role === ASSIGNABLE_ROLES[0])!;
        const event = await createEvent(eventType);
        const otherEventType = eventType === "rotating" ? "fixed_partner" : "rotating";

        await db.insert(eventAssignmentsTable).values({
          userId: assignee.id,
          eventId: event.id,
          eventType: otherEventType,
          eventRole: "event_captain",
        });

        const beforeAdd = await request(`/events/${eventType}/${event.id}/assignments`, organizer.token);
        assert.equal(beforeAdd.response.status, 200);
        assert.deepEqual(beforeAdd.body, []);

        const added = await request(`/events/${eventType}/${event.id}/assignments`, organizer.token, {
          method: "POST",
          body: JSON.stringify({ userId: assignee.id, eventRole: "event_captain" }),
        });
        assert.equal(added.response.status, 201);
        assert.equal(added.body.userId, assignee.id);
        assert.equal(added.body.eventId, event.id);
        assert.equal(added.body.eventType, eventType);

        const listed = await request(`/events/${eventType}/${event.id}/assignments`, organizer.token);
        assert.equal(listed.response.status, 200);
        assert.equal(listed.body.length, 1);
        assert.equal(listed.body[0].userId, assignee.id);
        assert.equal(listed.body[0].eventType, eventType);

        const removed = await request(
          `/events/${eventType}/${event.id}/assignments/${assignee.id}`,
          organizer.token,
          { method: "DELETE" },
        );
        assert.equal(removed.response.status, 204);

        const afterRemove = await request(`/events/${eventType}/${event.id}/assignments`, organizer.token);
        assert.equal(afterRemove.response.status, 200);
        assert.deepEqual(afterRemove.body, []);

        const otherFormatAssignment = await db
          .select()
          .from(eventAssignmentsTable)
          .where(
            and(
              eq(eventAssignmentsTable.eventId, event.id),
              eq(eventAssignmentsTable.eventType, otherEventType),
              eq(eventAssignmentsTable.userId, assignee.id),
            ),
          );
        assert.equal(otherFormatAssignment.length, 1);
      });
    }
  }

  for (const role of ASSIGNABLE_ROLES) {
    for (const eventType of ["rotating", "fixed_partner"] as const) {
      it(`${role} receives a clear 403 from every ${eventType} assignment-management endpoint`, async () => {
        const staff = users.find((user) => user.role === role)!;
        const event = await createEvent(eventType);

        await db.insert(eventAssignmentsTable).values({
          userId: staff.id,
          eventId: event.id,
          eventType,
          eventRole: "event_captain",
        });

        const listed = await request(`/events/${eventType}/${event.id}/assignments`, staff.token);
        assert.equal(listed.response.status, 403);
        assert.equal(listed.body.error, "Forbidden: cannot manage assignments for this event");

        const added = await request(`/events/${eventType}/${event.id}/assignments`, staff.token, {
          method: "POST",
          body: JSON.stringify({ userId: staff.id }),
        });
        assert.equal(added.response.status, 403);
        assert.equal(added.body.error, "Insufficient permissions");

        const removed = await request(
          `/events/${eventType}/${event.id}/assignments/${staff.id}`,
          staff.token,
          { method: "DELETE" },
        );
        assert.equal(removed.response.status, 403);
        assert.equal(removed.body.error, "Insufficient permissions");

        const assignment = await db
          .select()
          .from(eventAssignmentsTable)
          .where(
            and(
              eq(eventAssignmentsTable.eventId, event.id),
              eq(eventAssignmentsTable.eventType, eventType),
              eq(eventAssignmentsTable.userId, staff.id),
            ),
          );
        assert.equal(assignment.length, 1);
      });
    }
  }
});

describe("event deletion cleanup", () => {
  for (const eventType of ["rotating", "fixed_partner"] as const) {
    it(`deletes only ${eventType} registrations and assignments for the event`, async () => {
      const organizer = users.find((user) => user.role === ORGANIZER_ROLE)!;
      const event = await createEvent(eventType);
      const otherEventType = eventType === "rotating" ? "fixed_partner" : "rotating";

      await createAccessRegistration(eventType, event.id, "confirmed");
      const otherRegistration = await createAccessRegistration(otherEventType, event.id, "confirmed");
      const assignee = users.find((user) => user.role === ASSIGNABLE_ROLES[0])!;
      await db.insert(eventAssignmentsTable).values([
        { userId: assignee.id, eventId: event.id, eventType, eventRole: "event_captain" },
        { userId: organizer.id, eventId: event.id, eventType: otherEventType, eventRole: "event_organizer" },
      ]);

      const deleted = await request(`/events/${eventType}/${event.id}`, organizer.token, {
        method: "DELETE",
      });
      assert.equal(deleted.response.status, 204);

      const remainingRegistrations = await db
        .select()
        .from(registrationsTable)
        .where(eq(registrationsTable.eventId, event.id));
      assert.deepEqual(
        remainingRegistrations.map(({ id, eventType: remainingType }) => ({ id, eventType: remainingType })),
        [{ id: otherRegistration.id, eventType: otherEventType }],
      );
      const remainingAssignments = await db
        .select()
        .from(eventAssignmentsTable)
        .where(eq(eventAssignmentsTable.eventId, event.id));
      assert.deepEqual(
        remainingAssignments.map(({ userId, eventId, eventType: remainingType }) => ({
          userId,
          eventId,
          eventType: remainingType,
        })),
        [{ userId: organizer.id, eventId: event.id, eventType: otherEventType }],
      );

      const eventRows =
        eventType === "rotating"
          ? await db
              .select()
              .from(eventsRotatingTable)
              .where(eq(eventsRotatingTable.id, event.id))
          : await db
              .select()
              .from(eventsFixedTable)
              .where(eq(eventsFixedTable.id, event.id));
      assert.deepEqual(eventRows, []);
    });
  }

  it("rolls back the event and all dependent cleanup when a dependent delete fails", async () => {
    const organizer = users.find((user) => user.role === ORGANIZER_ROLE)!;
    const assignee = users.find((user) => user.role === ASSIGNABLE_ROLES[0])!;
    const event = await createRotatingEvent();
    const registration = await createAccessRegistration("rotating", event.id, "confirmed");
    await db.insert(eventAssignmentsTable).values({
      userId: assignee.id,
      eventId: event.id,
      eventType: "rotating",
      eventRole: "event_captain",
    });

    const triggerName = `event_delete_rollback_${event.id}`;
    const functionName = `event_delete_rollback_fn_${event.id}`;
    await db.execute(sql.raw(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.event_id = ${event.id} AND OLD.event_type = 'rotating' THEN
          RAISE EXCEPTION 'forced event deletion failure';
        END IF;
        RETURN OLD;
      END;
      $$;
      CREATE TRIGGER "${triggerName}"
      BEFORE DELETE ON atl_dupr_event_roles
      FOR EACH ROW EXECUTE FUNCTION "${functionName}"();
    `));

    try {
      const deleted = await request(`/events/rotating/${event.id}`, organizer.token, {
        method: "DELETE",
      });
      assert.equal(deleted.response.status, 500);
    } finally {
      await db.execute(sql.raw(`
        DROP TRIGGER IF EXISTS "${triggerName}" ON atl_dupr_event_roles;
        DROP FUNCTION IF EXISTS "${functionName}"();
      `));
    }

    const eventRows = await db
      .select()
      .from(eventsRotatingTable)
      .where(eq(eventsRotatingTable.id, event.id));
    assert.equal(eventRows.length, 1);

    const remainingRegistrations = await db
      .select()
      .from(registrationsTable)
      .where(
        and(
          eq(registrationsTable.eventId, event.id),
          eq(registrationsTable.eventType, "rotating"),
        ),
      );
    assert.deepEqual(remainingRegistrations.map(({ id }) => id), [registration.id]);

    const remainingAssignments = await db
      .select()
      .from(eventAssignmentsTable)
      .where(
        and(
          eq(eventAssignmentsTable.eventId, event.id),
          eq(eventAssignmentsTable.eventType, "rotating"),
        ),
      );
    assert.equal(remainingAssignments.length, 1);
  });
});

describe("event assignment event existence", () => {
  for (const eventType of ["rotating", "fixed_partner"] as const) {
    it(`does not create a ${eventType} assignment for a missing event`, async () => {
      const organizer = users.find((user) => user.role === ORGANIZER_ROLE)!;
      const assignee = users.find((user) => user.role === ASSIGNABLE_ROLES[0])!;
      const eventId = 2_000_000_000 + (eventType === "rotating" ? 1 : 2);

      const result = await request(`/events/${eventType}/${eventId}/assignments`, organizer.token, {
        method: "POST",
        body: JSON.stringify({ userId: assignee.id }),
      });

      assert.equal(result.response.status, 404);
      assert.equal(result.body.error, "Event not found");

      const assignments = await db
        .select()
        .from(eventAssignmentsTable)
        .where(
          and(
            eq(eventAssignmentsTable.eventId, eventId),
            eq(eventAssignmentsTable.eventType, eventType),
            eq(eventAssignmentsTable.userId, assignee.id),
          ),
        );
      assert.deepEqual(assignments, []);
    });
  }
});