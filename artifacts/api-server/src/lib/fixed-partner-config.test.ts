import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";

import fixedPartnerConfigDocument from "../../../../app-config/fixed-partner-config.json";
import fixedPartnerConfigSchema from "../../../../app-config/fixed-partner-config.schema.json";

import {
  fixedPartnerConfig,
  getFixedPartnerRequirement,
  loadFixedPartnerConfig,
} from "./fixed-partner-config.js";
import type { FixedPartnerRequirement } from "./fixed-partner-config.js";

function formatSchemaErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(
      ({ instancePath, keyword, message, params, schemaPath }) =>
        `${instancePath || "<root>"} ${message ?? "is invalid"} ` +
        `(keyword: ${keyword}, schema: ${schemaPath}, params: ${JSON.stringify(params)})`,
    )
    .join("\n");
}

type RequirementContract = {
  consumer: string;
  fields: readonly string[];
};

/**
 * This is the deliberately small bridge between declarative requirement keys
 * and the code paths that consume them. Keep documented metadata requirements
 * in this inventory too, even when they have no runtime-read fields, so an
 * accidental addition or removal is reported instead of being schema-valid
 * but disconnected from the application.
 */
const FIXED_PARTNER_REQUIREMENT_CONTRACT: Record<string, RequirementContract> =
  {
    partner_registration: {
      consumer:
        "registrations.ts registration creation and event-detail.tsx partner form",
      fields: ["required", "acceptedIdentifiers"],
    },
    team_capacity: {
      consumer: "eventController.ts fixed-partner team-capacity model",
      fields: [],
    },
    team_capacity_enforcement: {
      consumer:
        "registrations.ts and eventController.ts fixed-partner capacity decisions",
      fields: [
        "condition.operations",
        "capacityUnit",
        "capacityField",
        "countedStatus",
        "fullCapacityActions.registration_create.waitlistEnabled",
        "fullCapacityActions.registration_reactivate.waitlistEnabled",
        "fullCapacityActions.approval.waitlistEnabled",
        "fullCapacityActions.waitlist_promotion.waitlistEnabled",
        "fullCapacityActions.roster_edit.waitlistEnabled",
      ],
    },
    event_limit_safety: {
      consumer: "eventController.ts fixed-partner maxTeams updates",
      fields: [
        "condition.operation",
        "limitField",
        "minimumSource",
        "onConflict",
      ],
    },
    capacity_defaults: {
      consumer:
        "eventController.ts and event-defaults-server fixed-partner defaults",
      fields: [],
    },
    partner_rating_gap: {
      consumer:
        "registrations.ts registration and roster-edit rating-gap checks",
      fields: [
        "condition.ratingType",
        "condition.approvalMode",
        "condition.resolvedPartner",
        "condition.bothEffectiveRatings",
      ],
    },
    nr_partner_check: {
      consumer: "registrations.ts public fixed-partner NR validation",
      fields: ["condition.ratingType", "condition.publicRequest"],
    },
    partner_rating_range: {
      consumer: "registrations.ts fixed-partner partner range validation",
      fields: [
        "condition.ratingType",
        "condition.approvalMode",
        "condition.resolvedPartner",
        "includePartner",
      ],
    },
    admin_add_input: {
      consumer: "events-detail-fixed.tsx organizer add-player input limits",
      fields: ["maxPrimaryEmailsPerSubmission"],
    },
    public_partner_preflight: {
      consumer:
        "registrations.ts request-code preflight and event-detail.tsx signup warning",
      fields: ["condition.publicSignup", "requirePartnerBeforeCode"],
    },
    roster_edit_validation: {
      consumer: "registrations.ts fixed-partner roster-edit validation",
      fields: [
        "condition.operation",
        "condition.ratingTypes",
        "condition.approvalMode",
        "condition.resolvedPartner",
        "checks",
        "staffBypass",
      ],
    },
    active_team_membership: {
      consumer: "registrations.ts fixed-partner duplicate-membership checks",
      fields: [
        "condition.operations",
        "scope",
        "membershipRoles",
        "activeStatuses",
        "excludeCurrentRegistrationOnEdit",
      ],
    },
    membership_write_serialization: {
      consumer:
        "registrations.ts serialized fixed-partner registration and roster writes",
      fields: [
        "condition.operations",
        "lockStrategy",
        "lockScope",
        "lockNamespace",
      ],
    },
    capacity_write_serialization: {
      consumer:
        "registrations.ts and eventController.ts serialized capacity writes",
      fields: [
        "condition.operations",
        "lockStrategy",
        "lockScope",
        "lockNamespace",
      ],
    },
  };

const FIXED_PARTNER_RUNTIME_CONFIG_FIELDS = [
  {
    path: "format",
    consumer: "eventController.ts and registrations.ts event-format dispatch",
  },
  {
    path: "defaults.capacity.minTeams",
    consumer: "eventController.ts fixed-event creation defaults",
  },
  {
    path: "defaults.capacity.maxTeams",
    consumer: "eventController.ts fixed-event creation defaults",
  },
  {
    path: "defaults.capacity.minParticipants",
    consumer: "event-defaults-server fixed-event defaults",
  },
  {
    path: "defaults.capacity.maxParticipants",
    consumer: "event-defaults-server fixed-event defaults",
  },
  {
    path: "defaults.rating.maxPartnerGap",
    consumer: "registrations.ts rating-gap fallback",
  },
] as const;

function hasOwnPath(value: unknown, path: string): boolean {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (
      !current ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return false;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

describe("fixed-partner configuration", () => {
  it("matches the fixed-partner JSON Schema", () => {
    const ajv = new Ajv2020({
      allErrors: true,
      // Conditional subschemas rely on their parent properties' types.
      strictTypes: false,
    });
    const validate = ajv.compile(fixedPartnerConfigSchema);

    assert.ok(
      validate(fixedPartnerConfigDocument),
      `fixed-partner-config.json does not match fixed-partner-config.schema.json:\n${formatSchemaErrors(validate.errors)}`,
    );
  });

  it("rejects disconnected requirement inventory metadata in schema and loader", () => {
    const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
    const validate = ajv.compile(fixedPartnerConfigSchema);
    const invalidCases: Array<{
      name: string;
      mutate: (document: any) => void;
    }> = [
      {
        name: "unknown requirement key",
        mutate(document) {
          document.requirements[0].key = "partner_registraton";
        },
      },
      {
        name: "missing requirement",
        mutate(document) {
          document.requirements.pop();
        },
      },
      {
        name: "unknown capacity operation",
        mutate(document) {
          document.requirements
            .find(
              (requirement: any) =>
                requirement.key === "team_capacity_enforcement",
            )
            .condition.operations.push("capacity_override");
        },
      },
      {
        name: "duplicate capacity operation",
        mutate(document) {
          document.requirements
            .find(
              (requirement: any) =>
                requirement.key === "team_capacity_enforcement",
            )
            .condition.operations.push("approval");
        },
      },
      {
        name: "unexpected requirement property",
        mutate(document) {
          document.requirements[0].unexpectedRuleMetadata = true;
        },
      },
      {
        name: "known property assigned to the wrong requirement",
        mutate(document) {
          document.requirements[0].limitField = "maxTeams";
        },
      },
      {
        name: "known condition assigned to the wrong requirement",
        mutate(document) {
          document.requirements[0].condition.operation = "roster_edit";
        },
      },
      {
        name: "missing required legacy metadata",
        mutate(document) {
          delete document.requirements[0].acceptedIdentifiers;
        },
      },
    ];

    for (const invalidCase of invalidCases) {
      const document = structuredClone(fixedPartnerConfigDocument);
      invalidCase.mutate(document);
      assert.equal(
        validate(document),
        false,
        `${invalidCase.name} should fail JSON Schema validation`,
      );
      assert.throws(
        () => loadFixedPartnerConfig(document),
        Error,
        `${invalidCase.name} should fail runtime loading`,
      );
    }
  });

  it("keeps declarative requirement keys and runtime consumers in parity", () => {
    const declaredRequirements = new Map<string, FixedPartnerRequirement>(
      fixedPartnerConfig.requirements.map((requirement) => [
        requirement.key,
        requirement,
      ]),
    );
    const expectedKeys = Object.keys(FIXED_PARTNER_REQUIREMENT_CONTRACT);
    const declaredKeys = [...declaredRequirements.keys()];
    const missingKeys = expectedKeys.filter(
      (key) => !declaredRequirements.has(key),
    );
    const unexpectedKeys = declaredKeys.filter(
      (key) =>
        !Object.prototype.hasOwnProperty.call(
          FIXED_PARTNER_REQUIREMENT_CONTRACT,
          key,
        ),
    );
    const missingFields = expectedKeys.flatMap((key) => {
      const requirement = declaredRequirements.get(key);
      if (!requirement) return [];
      return FIXED_PARTNER_REQUIREMENT_CONTRACT[key].fields
        .filter((field) => !hasOwnPath(requirement, field))
        .map((field) => ({
          key,
          field,
          consumer: FIXED_PARTNER_REQUIREMENT_CONTRACT[key].consumer,
        }));
    });
    const missingRuntimeConfigFields =
      FIXED_PARTNER_RUNTIME_CONFIG_FIELDS.filter(
        ({ path }) => !hasOwnPath(fixedPartnerConfig, path),
      ).map(({ path, consumer }) => ({ path, consumer }));

    const parityErrors: string[] = [];
    if (missingKeys.length > 0) {
      parityErrors.push(
        `missing requirement keys:\n${missingKeys
          .map(
            (key) =>
              `- ${key} (consumed by ${FIXED_PARTNER_REQUIREMENT_CONTRACT[key].consumer})`,
          )
          .join("\n")}`,
      );
    }
    if (unexpectedKeys.length > 0) {
      parityErrors.push(
        `unexpected requirement keys:\n${unexpectedKeys
          .map(
            (key) => `- ${key} (not listed in the runtime consumer contract)`,
          )
          .join("\n")}`,
      );
    }
    if (missingFields.length > 0) {
      parityErrors.push(
        `missing consumed configuration fields:\n${missingFields
          .map(
            ({ key, field, consumer }) =>
              `- ${key}.${field} (consumed by ${consumer})`,
          )
          .join("\n")}`,
      );
    }
    if (missingRuntimeConfigFields.length > 0) {
      parityErrors.push(
        `missing runtime configuration fields:\n${missingRuntimeConfigFields
          .map(({ path, consumer }) => `- ${path} (consumed by ${consumer})`)
          .join("\n")}`,
      );
    }

    assert.equal(
      parityErrors.length,
      0,
      `Fixed-partner declarative/runtime parity check failed:\n${parityErrors.join("\n")}`,
    );
  });

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
      "team_capacity_enforcement",
      "event_limit_safety",
      "capacity_defaults",
      "partner_rating_gap",
      "nr_partner_check",
      "partner_rating_range",
      "admin_add_input",
      "public_partner_preflight",
      "roster_edit_validation",
      "active_team_membership",
      "membership_write_serialization",
      "capacity_write_serialization",
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

  it("rejects incomplete fixed-partner capacity operation coverage", () => {
    const malformed = structuredClone(fixedPartnerConfig);
    const capacity = malformed.requirements.find(
      (requirement) => requirement.key === "team_capacity_enforcement",
    );
    assert.ok(capacity && "condition" in capacity);
    const operationIndex =
      capacity.condition.operations?.indexOf("waitlist_promotion") ?? -1;
    assert.notEqual(operationIndex, -1);
    capacity.condition.operations?.splice(operationIndex, 1);

    assert.throws(
      () => loadFixedPartnerConfig(malformed),
      /team-capacity enforcement requirement is invalid/,
    );
  });

  it("rejects capacity locks that do not serialize with membership writes", () => {
    const malformed = structuredClone(fixedPartnerConfig);
    const serialization = malformed.requirements.find(
      (requirement) => requirement.key === "capacity_write_serialization",
    );
    assert.ok(serialization && "lockNamespace" in serialization);
    serialization.lockNamespace = "different-lock";

    assert.throws(
      () => loadFixedPartnerConfig(malformed),
      /capacity-write serialization requirement is invalid/,
    );
  });

  it("fails clearly when a required rule is missing", () => {
    assert.throws(
      () => getFixedPartnerRequirement("missing-rule"),
      /Missing fixed-partner requirement: missing-rule/,
    );
  });
});
