import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  fixedPartnerConfig,
  getFixedPartnerRequirement,
  loadFixedPartnerConfig,
} from "./fixed-partner-config.js";

describe("fixed-partner configuration", () => {
  it("contains the declarative rules used by fixed-partner registration", () => {
    assert.equal(fixedPartnerConfig.format, "fixed_partner");
    assert.deepEqual(fixedPartnerConfig.defaults.capacity, {
      minTeams: 2,
      maxTeams: 8,
      minParticipants: 4,
      maxParticipants: 12,
    });
    assert.equal(fixedPartnerConfig.defaults.rating.maxPartnerGap, 0.5);

    for (const key of [
      "partner_registration",
      "team_capacity",
      "capacity_defaults",
      "partner_rating_gap",
      "nr_partner_check",
      "partner_rating_range",
      "admin_add_input",
      "public_partner_preflight",
    ]) {
      assert.equal(getFixedPartnerRequirement(key).key, key);
    }
  });

  it("rejects malformed requirement IDs with a clear error", () => {
    const malformed = structuredClone(fixedPartnerConfig);
    malformed.requirements[0].id = "not-a-short-uuid";

    assert.throws(
      () => loadFixedPartnerConfig(malformed),
      /requirements must have unique short UUIDs and fixed_partner conditions/,
    );
  });

  it("rejects duplicate requirement IDs with a clear error", () => {
    const duplicate = structuredClone(fixedPartnerConfig);
    duplicate.requirements[1].id = duplicate.requirements[0].id;

    assert.throws(
      () => loadFixedPartnerConfig(duplicate),
      /requirement UUIDs must be unique/,
    );
  });

  it("fails clearly when a required rule is missing", () => {
    assert.throws(
      () => getFixedPartnerRequirement("missing-rule"),
      /Missing fixed-partner requirement: missing-rule/,
    );
  });
});