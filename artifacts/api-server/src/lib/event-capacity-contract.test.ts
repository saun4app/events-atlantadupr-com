import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CreateEventBody, UpdateEventBody } from "@workspace/api-zod";

describe("event capacity API contracts", () => {
  it("create accepts positive participant and team limits", () => {
    const result = CreateEventBody.safeParse({
      name: "Contract test event",
      startDatetime: "2026-09-01T18:00:00.000Z",
      endDatetime: "2026-09-01T20:00:00.000Z",
      locationName: "Contract test court",
      locationAddress: "123 Test Street",
      ratingTypeRequired: "doubles",
      minParticipants: 1,
      maxParticipants: 16,
      minTeams: 1,
      maxTeams: 8,
      waitlistEnabled: true,
      requireApproval: "none",
      signupStartDatetime: "2026-08-01T18:00:00.000Z",
      signupEndDatetime: "2026-08-31T18:00:00.000Z",
    });

    assert.equal(result.success, true);
  });

  it("update accepts positive participant and team limits", () => {
    const result = UpdateEventBody.safeParse({
      minParticipants: 1,
      maxParticipants: 16,
      minTeams: 1,
      maxTeams: 8,
    });

    assert.equal(result.success, true);
  });

  for (const [schemaName, schema, basePayload] of [
    ["create", CreateEventBody, {
      name: "Contract test event",
      startDatetime: "2026-09-01T18:00:00.000Z",
      endDatetime: "2026-09-01T20:00:00.000Z",
      locationName: "Contract test court",
      locationAddress: "123 Test Street",
      ratingTypeRequired: "doubles",
      waitlistEnabled: true,
      requireApproval: "none",
      signupStartDatetime: "2026-08-01T18:00:00.000Z",
      signupEndDatetime: "2026-08-31T18:00:00.000Z",
    }],
    ["update", UpdateEventBody, {}],
  ] as const) {
    it(`${schemaName} rejects non-positive and non-numeric limits`, () => {
      for (const value of [0, -1, "16", Number.NaN]) {
        const result = schema.safeParse({
          ...basePayload,
          minParticipants: value,
          maxParticipants: value,
          minTeams: value,
          maxTeams: value,
        });

        assert.equal(result.success, false, `expected ${String(value)} to be rejected`);
      }
    });
  }
});