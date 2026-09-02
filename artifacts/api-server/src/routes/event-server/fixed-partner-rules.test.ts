import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Server, AddressInfo } from "node:net";

import {
  db,
  pool,
  emailVerificationCodesTable,
  eventDefaultsTable,
  eventsFixedTable,
  eventsRotatingTable,
  membersTable,
  registrationsTable,
  sessionsTable,
  userRoleIdMap,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

import app from "../../app.js";
import { issueCode } from "../../lib/verification.js";
import { fixedPartnerConfig, getFixedPartnerRequirement } from "../../lib/fixed-partner-config.js";

const STAFF_TOKEN = "fixed-partner-test-staff-" + Math.random().toString(36).slice(2);

let server: Server;
let baseUrl: string;

const createdEventIds: number[] = [];
const createdRotatingEventIds: number[] = [];
const createdMemberIds: string[] = [];
const createdEmails: string[] = [];

async function createEvent(
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
      ratingTypeRequired: "none",
      ratingConfig: null,
      minTeams: 2,
      maxTeams: 8,
      waitlistEnabled: true,
      requireApproval: "none",
      signupStartDatetime: new Date(now - 86_400_000),
      signupEndDatetime: new Date(now + 6 * 86_400_000),
      status: "upcoming",
      ...overrides,
    })
    .returning();
  createdEventIds.push(event.id);
  return event;
}

async function createMember(
  overrides: Partial<typeof membersTable.$inferInsert> = {},
) {
  const duprId =
    overrides.duprId ??
    "FP" + Math.random().toString(36).slice(2, 10).toUpperCase();
  const email =
    overrides.email ?? `${duprId.toLowerCase()}@fixed-partner.test`;
  const [member] = await db
    .insert(membersTable)
    .values({
      duprId,
      name: "Fixed Partner Test Player",
      doubles: "4.00",
      email,
      ...overrides,
    })
    .returning();
  createdMemberIds.push(member.duprId);
  if (member.email) createdEmails.push(member.email);
  return member;
}

async function registerStaff(
  eventId: number,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `${baseUrl}/events/fixed_partner/${eventId}/registrations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${STAFF_TOKEN}`,
      },
      body: JSON.stringify(body),
    },
  );
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as any,
  };
}

async function registerPublic(
  eventId: number,
  memberEmail: string,
  body: Record<string, unknown> = {},
) {
  const code = await issueCode(memberEmail);
  assert.equal(typeof code, "string");
  const response = await fetch(
    `${baseUrl}/events/fixed_partner/${eventId}/registrations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: memberEmail, code, ...body }),
    },
  );
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as any,
  };
}

async function registerRotatingStaff(
  eventId: number,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `${baseUrl}/events/rotating/${eventId}/registrations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${STAFF_TOKEN}`,
      },
      body: JSON.stringify(body),
    },
  );
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as any,
  };
}

async function updateRegistration(
  eventType: "fixed_partner" | "rotating",
  eventId: number,
  registrationId: number,
  body: Record<string, unknown>,
) {
  const response = await fetch(
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
  return {
    status: response.status,
    body: (await response.json().catch(() => null)) as any,
  };
}

async function createRotatingEvent(
  overrides: Partial<typeof eventsRotatingTable.$inferInsert> = {},
) {
  const now = Date.now();
  const [event] = await db
    .insert(eventsRotatingTable)
    .values({
      name: "Rotating Test " + Math.random().toString(36).slice(2),
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
  createdRotatingEventIds.push(event.id);
  return event;
}

before(async () => {
  await db
    .insert(sessionsTable)
    .values({ token: STAFF_TOKEN, data: { userId: -1, role: userRoleIdMap.app_admin } })
    .onConflictDoUpdate({
      target: sessionsTable.token,
      set: { data: { userId: -1, role: userRoleIdMap.app_admin } },
    });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

afterEach(async () => {
  for (const eventId of createdEventIds) {
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
  for (const eventId of createdRotatingEventIds) {
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
  createdRotatingEventIds.length = 0;
  createdMemberIds.length = 0;
  createdEmails.length = 0;
});

after(async () => {
  await db.delete(sessionsTable).where(eq(sessionsTable.token, STAFF_TOKEN));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("fixed-partner registration requirements", () => {
  it("loads the extracted roster-integrity requirements from configuration", () => {
    const rosterEdit = getFixedPartnerRequirement("roster_edit_validation");
    const membership = getFixedPartnerRequirement("active_team_membership");
    const serialization = getFixedPartnerRequirement("membership_write_serialization");
    const capacity = getFixedPartnerRequirement("team_capacity_enforcement");
    const eventLimit = getFixedPartnerRequirement("event_limit_safety");
    const capacitySerialization = getFixedPartnerRequirement(
      "capacity_write_serialization",
    );

    assert.equal(fixedPartnerConfig.requirements.length, 14);
    assert.deepEqual(rosterEdit.condition.ratingTypes, ["dupr", "self_numeric"]);
    assert.deepEqual(rosterEdit.checks, ["nr", "rating_range", "partner_rating_gap"]);
    assert.equal(rosterEdit.staffBypass, true);
    assert.deepEqual(membership.activeStatuses, [
      "confirmed",
      "waitlisted",
      "pending_approval",
    ]);
    assert.equal(membership.scope, "event");
    assert.equal(membership.excludeCurrentRegistrationOnEdit, true);
    assert.deepEqual(serialization.condition.operations, [
      "registration_create",
      "registration_reactivate",
      "roster_edit",
    ]);
    assert.equal(serialization.lockStrategy, "postgres_advisory_xact");
    assert.equal(serialization.lockScope, "event");
    assert.equal(serialization.lockNamespace, "atl-dupr:fixed-partner");
    assert.deepEqual(capacity.condition.operations, [
      "registration_create",
      "registration_reactivate",
      "approval",
      "waitlist_promotion",
      "roster_edit",
    ]);
    assert.equal(capacity.capacityUnit, "team");
    assert.equal(capacity.capacityField, "maxTeams");
    assert.equal(capacity.countedStatus, "confirmed");
    assert.deepEqual(capacity.fullCapacityActions.waitlist_promotion, {
      waitlistEnabled: "reject",
      waitlistDisabled: "reject",
    });
    assert.equal(eventLimit.condition.operation, "event_limit_update");
    assert.equal(eventLimit.limitField, "maxTeams");
    assert.equal(eventLimit.minimumSource, "confirmed_team_count");
    assert.equal(eventLimit.onConflict, "reject");
    assert.deepEqual(capacitySerialization.condition.operations, [
      "registration_create",
      "registration_reactivate",
      "approval",
      "waitlist_promotion",
      "roster_edit",
      "event_limit_update",
    ]);
    assert.equal(
      capacitySerialization.lockNamespace,
      serialization.lockNamespace,
    );
  });

  it("requires a partner identifier", async () => {
    const event = await createEvent();
    const player = await createMember();

    const result = await registerStaff(event.id, {
      memberDuprId: player.duprId,
    });

    assert.equal(result.status, 400);
    assert.match(result.body.error, /partnerDuprId or partnerEmail is required/);
  });

  it("rejects players already assigned to another active fixed-partner team", async () => {
    const event = await createEvent();
    const primary = await createMember();
    const partner = await createMember();
    const replacementPrimary = await createMember();
    const firstTeam = await registerStaff(event.id, {
      memberDuprId: primary.duprId,
      partnerDuprId: partner.duprId,
    });
    assert.equal(firstTeam.status, 201);

    const duplicatePrimaryResult = await registerStaff(event.id, {
      memberDuprId: partner.duprId,
      partnerDuprId: replacementPrimary.duprId,
    });
    assert.equal(duplicatePrimaryResult.status, 409);
    assert.match(duplicatePrimaryResult.body.error, /already assigned to another team/);

    const duplicatePartnerResult = await registerStaff(event.id, {
      memberDuprId: replacementPrimary.duprId,
      partnerDuprId: primary.duprId,
    });
    assert.equal(duplicatePartnerResult.status, 409);
    assert.match(duplicatePartnerResult.body.error, /already assigned to another team/);
  });

  it("serializes concurrent sign-ups that claim the same player", async () => {
    const event = await createEvent();
    const sharedPlayer = await createMember();
    const firstPartner = await createMember();
    const secondPartner = await createMember();

    const results = await Promise.all([
      registerStaff(event.id, {
        memberDuprId: sharedPlayer.duprId,
        partnerDuprId: firstPartner.duprId,
      }),
      registerStaff(event.id, {
        memberDuprId: secondPartner.duprId,
        partnerDuprId: sharedPlayer.duprId,
      }),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [201, 409],
    );
    const registrations = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, event.id), eq(registrationsTable.eventType, "fixed_partner")));
    const activeRegistrations = registrations.filter((registration) =>
      ["confirmed", "waitlisted", "pending_approval"].includes(registration.status),
    );
    assert.equal(activeRegistrations.length, 1);
    assert.equal(
      activeRegistrations.filter(
        (registration) =>
          registration.memberDuprId === sharedPlayer.duprId ||
          registration.partnerDuprId === sharedPlayer.duprId,
      ).length,
      1,
    );
  });

  it("rejects NR players and NR partners on a public event when NR is disabled", async () => {
    const event = await createEvent({
      ratingTypeRequired: "dupr",
      ratingConfig: { min: 2, max: 5, nrAllowed: false },
    });
    const nrPlayer = await createMember({ doubles: null });
    const ratedPartner = await createMember({ doubles: "4.00" });

    const playerResult = await registerPublic(event.id, nrPlayer.email!, {
      partnerDuprId: ratedPartner.duprId,
    });
    assert.equal(playerResult.status, 400);
    assert.match(playerResult.body.error, /DUPR doubles rating is required/);

    const ratedPlayer = await createMember({ doubles: "4.00" });
    const nrPartner = await createMember({ doubles: null });
    const partnerResult = await registerPublic(event.id, ratedPlayer.email!, {
      partnerDuprId: nrPartner.duprId,
    });
    assert.equal(partnerResult.status, 400);
    assert.match(partnerResult.body.error, /partner needs a DUPR doubles rating/);
  });

  it("checks both participants against an enforced DUPR range", async () => {
    const event = await createEvent({
      ratingTypeRequired: "dupr",
      requireApproval: "enforce_rating",
      ratingConfig: { min: 3, max: 4.5, nrAllowed: true },
    });
    const outOfRangePlayer = await createMember({ doubles: "4.75" });
    const inRangePartner = await createMember({ doubles: "4.00" });

    const playerResult = await registerStaff(event.id, {
      memberDuprId: outOfRangePlayer.duprId,
      partnerDuprId: inRangePartner.duprId,
    });
    assert.equal(playerResult.status, 400);
    assert.match(playerResult.body.error, /Your DUPR rating .* outside/);

    const inRangePlayer = await createMember({ doubles: "4.00" });
    const outOfRangePartner = await createMember({ doubles: "4.75" });
    const partnerResult = await registerStaff(event.id, {
      memberDuprId: inRangePlayer.duprId,
      partnerDuprId: outOfRangePartner.duprId,
    });
    assert.equal(partnerResult.status, 400);
    assert.match(partnerResult.body.error, /partner's DUPR rating .* outside/);
  });

  it("uses the 0.5 DUPR partner-gap fallback and allows equality at the boundary", async () => {
    const event = await createEvent({
      ratingTypeRequired: "dupr",
      requireApproval: "enforce_rating",
      ratingConfig: { min: 2, max: 5, nrAllowed: true },
    });
    const playerAtBoundary = await createMember({ doubles: "4.00" });
    const partnerAtBoundary = await createMember({ doubles: "4.50" });

    const boundaryResult = await registerStaff(event.id, {
      memberDuprId: playerAtBoundary.duprId,
      partnerDuprId: partnerAtBoundary.duprId,
    });
    assert.equal(boundaryResult.status, 201);

    const playerOverGap = await createMember({ doubles: "4.00" });
    const partnerOverGap = await createMember({ doubles: "4.51" });
    const overGapResult = await registerStaff(event.id, {
      memberDuprId: playerOverGap.duprId,
      partnerDuprId: partnerOverGap.duprId,
    });
    assert.equal(overGapResult.status, 400);
    assert.match(overGapResult.body.error, /at most 0\.50/);
  });

  it("preserves staff bypass behavior for NR and enforced-rating rules", async () => {
    const event = await createEvent({
      ratingTypeRequired: "dupr",
      requireApproval: "enforce_rating",
      ratingConfig: { min: 3, max: 4, nrAllowed: false },
    });
    const nrPlayer = await createMember({ doubles: null });
    const outOfRangePartner = await createMember({ doubles: "5.00" });

    const result = await registerStaff(event.id, {
      memberDuprId: nrPlayer.duprId,
      partnerDuprId: outOfRangePartner.duprId,
      bypassRatingRequirements: true,
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.status, "confirmed");
  });
});

describe("fixed-partner roster edits", () => {
  it("rejects replacing either player with someone on another active team but allows the current assignment", async () => {
    const event = await createEvent();
    const firstPrimary = await createMember();
    const firstPartner = await createMember();
    const secondPrimary = await createMember();
    const secondPartner = await createMember();
    const firstTeam = await registerStaff(event.id, {
      memberDuprId: firstPrimary.duprId,
      partnerDuprId: firstPartner.duprId,
    });
    const secondTeam = await registerStaff(event.id, {
      memberDuprId: secondPrimary.duprId,
      partnerDuprId: secondPartner.duprId,
    });
    assert.equal(firstTeam.status, 201);
    assert.equal(secondTeam.status, 201);

    const unchanged = await updateRegistration(
      "fixed_partner",
      event.id,
      firstTeam.body.id,
      {
        memberDuprId: firstPrimary.duprId,
        partnerDuprId: firstPartner.duprId,
      },
    );
    assert.equal(unchanged.status, 200);

    const duplicatePartner = await updateRegistration(
      "fixed_partner",
      event.id,
      secondTeam.body.id,
      { partnerDuprId: firstPartner.duprId },
    );
    assert.equal(duplicatePartner.status, 409);
    assert.match(duplicatePartner.body.error, /already assigned to another team/);

    const duplicatePrimary = await updateRegistration(
      "fixed_partner",
      event.id,
      secondTeam.body.id,
      { memberDuprId: firstPrimary.duprId },
    );
    assert.equal(duplicatePrimary.status, 409);
    assert.match(duplicatePrimary.body.error, /already assigned to another team/);
  });

  it("serializes concurrent roster edits that claim the same player", async () => {
    const event = await createEvent();
    const firstPrimary = await createMember();
    const firstPartner = await createMember();
    const secondPrimary = await createMember();
    const secondPartner = await createMember();
    const sharedReplacement = await createMember();
    const firstTeam = await registerStaff(event.id, {
      memberDuprId: firstPrimary.duprId,
      partnerDuprId: firstPartner.duprId,
    });
    const secondTeam = await registerStaff(event.id, {
      memberDuprId: secondPrimary.duprId,
      partnerDuprId: secondPartner.duprId,
    });
    assert.equal(firstTeam.status, 201);
    assert.equal(secondTeam.status, 201);

    const results = await Promise.all([
      updateRegistration("fixed_partner", event.id, firstTeam.body.id, {
        partnerDuprId: sharedReplacement.duprId,
      }),
      updateRegistration("fixed_partner", event.id, secondTeam.body.id, {
        partnerDuprId: sharedReplacement.duprId,
      }),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort((a, b) => a - b),
      [200, 409],
    );
    const registrations = await db
      .select()
      .from(registrationsTable)
      .where(and(eq(registrationsTable.eventId, event.id), eq(registrationsTable.eventType, "fixed_partner")));
    assert.equal(
      registrations.filter(
        (registration) =>
          ["confirmed", "waitlisted", "pending_approval"].includes(registration.status) &&
          (registration.memberDuprId === sharedReplacement.duprId ||
            registration.partnerDuprId === sharedReplacement.duprId),
      ).length,
      1,
    );
  });

  it("requires a known partner and rechecks NR and enforced rating rules when replacing either player", async () => {
    const event = await createEvent({
      ratingTypeRequired: "dupr",
      requireApproval: "enforce_rating",
      ratingConfig: { min: 3, max: 4.5, nrAllowed: false },
    });
    const primary = await createMember({ doubles: "4.00" });
    const partner = await createMember({ doubles: "4.00" });
    const registration = await registerStaff(event.id, {
      memberDuprId: primary.duprId,
      partnerDuprId: partner.duprId,
    });
    assert.equal(registration.status, 201);

    const nrPrimary = await createMember({ doubles: null });
    const nrResult = await updateRegistration(
      "fixed_partner",
      event.id,
      registration.body.id,
      { memberEmail: nrPrimary.email },
    );
    assert.equal(nrResult.status, 400);
    assert.match(nrResult.body.error, /does not allow non-rated/);

    const outOfRangePrimary = await createMember({ doubles: "4.75" });
    const primaryResult = await updateRegistration(
      "fixed_partner",
      event.id,
      registration.body.id,
      { memberDuprId: outOfRangePrimary.duprId },
    );
    assert.equal(primaryResult.status, 400);
    assert.match(primaryResult.body.error, /Your DUPR rating .* outside/);

    const outOfRangePartner = await createMember({ doubles: "4.75" });
    const partnerResult = await updateRegistration(
      "fixed_partner",
      event.id,
      registration.body.id,
      { partnerEmail: outOfRangePartner.email },
    );
    assert.equal(partnerResult.status, 400);
    assert.match(partnerResult.body.error, /partner's DUPR rating .* outside/);

    const missingPartnerResult = await updateRegistration(
      "fixed_partner",
      event.id,
      registration.body.id,
      { partnerDuprId: "" },
    );
    assert.equal(missingPartnerResult.status, 400);
    assert.match(missingPartnerResult.body.error, /partner is required/);

    const unknownPartnerResult = await updateRegistration(
      "fixed_partner",
      event.id,
      registration.body.id,
      { partnerDuprId: "UNKNOWN-FIXED-PARTNER" },
    );
    assert.equal(unknownPartnerResult.status, 404);
    assert.match(unknownPartnerResult.body.error, /No partner found/);
  });

  it("enforces the 0.5 DUPR partner gap when replacing a fixed-partner player", async () => {
    const event = await createEvent({
      ratingTypeRequired: "dupr",
      requireApproval: "enforce_rating",
      ratingConfig: { min: 2, max: 5, nrAllowed: true },
    });
    const primary = await createMember({ doubles: "4.00" });
    const partner = await createMember({ doubles: "4.00" });
    const registration = await registerStaff(event.id, {
      memberDuprId: primary.duprId,
      partnerDuprId: partner.duprId,
    });
    assert.equal(registration.status, 201);

    const replacementPartner = await createMember({ doubles: "4.51" });
    const result = await updateRegistration(
      "fixed_partner",
      event.id,
      registration.body.id,
      { partnerDuprId: replacementPartner.duprId },
    );
    assert.equal(result.status, 400);
    assert.match(result.body.error, /at most 0\.50/);
  });

  it("allows authorized staff to bypass fixed-partner rating checks explicitly", async () => {
    const event = await createEvent({
      ratingTypeRequired: "dupr",
      requireApproval: "enforce_rating",
      ratingConfig: { min: 3, max: 4, nrAllowed: false },
    });
    const primary = await createMember({ doubles: "4.00" });
    const partner = await createMember({ doubles: "4.00" });
    const registration = await registerStaff(event.id, {
      memberDuprId: primary.duprId,
      partnerDuprId: partner.duprId,
    });
    assert.equal(registration.status, 201);

    const nrPrimary = await createMember({ doubles: null });
    const outOfRangePartner = await createMember({ doubles: "5.00" });
    const result = await updateRegistration(
      "fixed_partner",
      event.id,
      registration.body.id,
      {
        memberEmail: nrPrimary.email,
        partnerEmail: outOfRangePartner.email,
        bypassRatingRequirements: true,
      },
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.memberDuprId, nrPrimary.duprId);
    assert.equal(result.body.partnerDuprId, outOfRangePartner.duprId);
  });

  it("retains rotating-event roster edit behavior without requiring a partner", async () => {
    const event = await createRotatingEvent();
    const primary = await createMember({ doubles: "4.00" });
    const replacement = await createMember({ doubles: "4.00" });
    const registration = await registerRotatingStaff(event.id, {
      memberDuprId: primary.duprId,
    });
    assert.equal(registration.status, 201);

    const result = await updateRegistration(
      "rotating",
      event.id,
      registration.body.id,
      { memberDuprId: replacement.duprId },
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.memberDuprId, replacement.duprId);
  });
});

describe("fixed-partner capacity defaults", () => {
  it("defaults created events to 2–8 teams", async () => {
    const now = new Date();
    const response = await fetch(`${baseUrl}/events/fixed_partner`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${STAFF_TOKEN}`,
      },
      body: JSON.stringify({
        name: "Default Capacity Test",
        locationName: "Test Court",
        startDatetime: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
        endDatetime: new Date(now.getTime() + 7 * 86_400_000 + 3_600_000).toISOString(),
        signupStartDatetime: new Date(now.getTime() - 86_400_000).toISOString(),
        signupEndDatetime: new Date(now.getTime() + 6 * 86_400_000).toISOString(),
      }),
    });
    const body = (await response.json()) as any[];
    assert.equal(response.status, 201);
    assert.equal(body.length, 1);
    assert.equal(body[0].minTeams, 2);
    assert.equal(body[0].maxTeams, 8);
    createdEventIds.push(body[0].id);
  });

  it("keeps event-default rows at 4–12 participants for fixed and 8–24 for rotating", async () => {
    const [fixedResponse, rotatingResponse] = await Promise.all([
      fetch(`${baseUrl}/event-defaults/fixed_partner`),
      fetch(`${baseUrl}/event-defaults/rotating`),
    ]);
    const fixed = (await fixedResponse.json()) as any;
    const rotating = (await rotatingResponse.json()) as any;

    assert.equal(fixedResponse.status, 200);
    assert.equal(fixed.minCapacity, 4);
    assert.equal(fixed.maxCapacity, 12);
    assert.equal(rotatingResponse.status, 200);
    assert.equal(rotating.minCapacity, 8);
    assert.equal(rotating.maxCapacity, 24);

    const rows = await db
      .select()
      .from(eventDefaultsTable)
      .where(eq(eventDefaultsTable.eventType, "fixed_partner"));
    assert.equal(rows[0]?.minCapacity, 4);
    assert.equal(rows[0]?.maxCapacity, 12);
  });
});