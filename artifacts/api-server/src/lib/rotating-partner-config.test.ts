import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";

import rotatingPartnerConfigDocument from "../../../../app-config/rotating-partner-config.json";
import rotatingPartnerConfigSchema from "../../../../app-config/rotating-partner-config.schema.json";
import {
  getRotatingPartnerRequirement,
  loadRotatingPartnerConfig,
  rotatingPartnerConfig,
} from "./rotating-partner-config.js";
import type { RotatingPartnerRequirement } from "./rotating-partner-config.js";

function formatSchemaErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(
      ({ instancePath, keyword, message, params, schemaPath }) =>
        `${instancePath || "<root>"} ${message ?? "is invalid"} ` +
        `(keyword: ${keyword}, schema: ${schemaPath}, params: ${JSON.stringify(params)})`,
    )
    .join("\n");
}

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

const ROTATING_REQUIREMENT_CONTRACT: Record<
  string,
  { consumer: string; fields: readonly string[] }
> = {
  participant_registration: {
    consumer: "registrations.ts rotating registration input validation",
    fields: ["required", "acceptedIdentifiers", "condition.operations"],
  },
  participant_capacity: {
    consumer: "registrations.ts participant-capacity model",
    fields: [
      "capacityUnit",
      "capacityField",
      "countedStatus",
      "registrationRepresents",
    ],
  },
  capacity_defaults: {
    consumer: "eventController.ts rotating event creation defaults",
    fields: ["defaultsPath"],
  },
  capacity_enforcement: {
    consumer: "registrations.ts rotating capacity decisions",
    fields: [
      "condition.operations",
      "capacityUnit",
      "capacityField",
      "countedStatus",
      "approvalPrecedesCapacity",
      "fullCapacityActions.registration_create.waitlistEnabled",
      "fullCapacityActions.registration_reactivate.waitlistEnabled",
      "fullCapacityActions.approval.waitlistEnabled",
      "fullCapacityActions.waitlist_promotion.waitlistEnabled",
      "fullCapacityActions.roster_edit.waitlistEnabled",
    ],
  },
  event_limit_safety: {
    consumer: "eventController.ts rotating event-limit updates",
    fields: [
      "condition.operation",
      "limitField",
      "minimumSource",
      "onConflict",
    ],
  },
  active_registration: {
    consumer: "registrations.ts duplicate rotating signup checks",
    fields: ["condition.operations", "scope", "activeStatuses"],
  },
  capacity_write_serialization: {
    consumer: "registrations.ts serialized rotating capacity writes",
    fields: [
      "condition.operations",
      "lockStrategy",
      "lockScope",
      "lockNamespace",
    ],
  },
  self_rating_input: {
    consumer: "registrations.ts and event-detail.tsx public self-rating flow",
    fields: [
      "condition.operation",
      "condition.ratingTypes",
      "condition.publicRequest",
      "required",
      "valueSource",
      "validationSource",
      "snapshotPath",
    ],
  },
  rating_enforcement: {
    consumer: "registrations.ts rotating enforced-rating flow",
    fields: [
      "condition.operation",
      "condition.ratingTypes",
      "condition.approvalMode",
      "staffBypassRequiresExplicitFlag",
      "nrUsesEventConfiguration",
      "rangeSource",
    ],
  },
  registration_access: {
    consumer: "registrations.ts rotating event access checks",
    fields: [
      "condition.operations",
      "condition.audience",
      "policy.allowedEventStatuses",
      "policy.publicSignupWindow",
      "policy.staffBypass",
      "policy.cancelledEventAction",
    ],
  },
  public_verification: {
    consumer: "registrations.ts public verification flow",
    fields: [
      "condition.operations",
      "condition.publicRequest",
      "policy.emailRequired",
      "policy.verificationCodeRequired",
      "policy.verifier",
      "policy.consumeOnSuccess",
      "policy.codeTtlSeconds",
      "policy.codeCooldownSeconds",
      "policy.maxCodeAttempts",
      "policy.requestCodeRateLimit",
      "policy.submissionRateLimit",
    ],
  },
  registration_reactivation: {
    consumer: "registrations.ts rotating reactivation flow",
    fields: [
      "condition.operation",
      "policy.historicalRows",
      "policy.candidateStatus",
      "policy.selection",
      "policy.updateMode",
      "policy.blockedStatuses",
      "policy.clearFields",
    ],
  },
  cancellation: {
    consumer: "registrations.ts public cancellation flow",
    fields: [
      "condition.operation",
      "condition.publicRequest",
      "policy.lookup",
      "policy.alreadyCancelledAction",
      "policy.cancelledStatus",
      "policy.consumeVerificationCode",
    ],
  },
  status_transitions: {
    consumer: "registrations.ts rotating status transitions",
    fields: [
      "condition.operations",
      "policy.statuses",
      "policy.approval",
      "policy.rejection",
      "policy.promotion",
      "policy.cancellation",
      "policy.reactivationClearsCancellationMetadata",
    ],
  },
  registration_snapshot: {
    consumer: "registrations.ts rotating snapshot writes",
    fields: [
      "condition.operations",
      "policy.source",
      "policy.sourceOfTruth",
      "policy.playerFields",
      "policy.partnerFields",
      "policy.assignedRating",
    ],
  },
  rating_validation: {
    consumer: "registrations.ts rotating rating validation",
    fields: [
      "condition.operation",
      "condition.ratingTypes",
      "policy.eventConfigSource",
      "policy.numericPrecision",
      "policy.numericRange",
      "policy.skillValue",
      "policy.nrRange",
      "policy.nrPrecision",
      "policy.missingRequiredConfig",
      "policy.staffBypassRequiresExplicitFlag",
    ],
  },
  event_settings_precedence: {
    consumer: "eventController.ts and rotating event forms",
    fields: [
      "condition.operations",
      "policy.eventSpecificSource",
      "policy.globalDefaultsSource",
      "policy.jsonDefaultsRole",
      "policy.cloneSource",
      "policy.serverAuthority",
    ],
  },
  roster_summary: {
    consumer: "eventController.ts rotating roster summary",
    fields: [
      "condition.operation",
      "policy.countedStatuses",
      "policy.excludedStatuses",
      "policy.total",
      "policy.capacitySource",
      "policy.teamFields",
    ],
  },
};

describe("rotating-partner configuration", () => {
  it("matches the rotating-partner JSON Schema", () => {
    const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
    const validate = ajv.compile(rotatingPartnerConfigSchema);

    assert.ok(
      validate(rotatingPartnerConfigDocument),
      `rotating-partner-config.json does not match rotating-partner-config.schema.json:\n${formatSchemaErrors(validate.errors)}`,
    );
  });

  it("keeps declarative requirements and runtime consumers in parity", () => {
    const declared = new Map<string, RotatingPartnerRequirement>(
      rotatingPartnerConfig.requirements.map((requirement) => [
        requirement.key,
        requirement,
      ]),
    );
    const expectedKeys = Object.keys(ROTATING_REQUIREMENT_CONTRACT);
    const declaredKeys = [...declared.keys()];
    const missing = expectedKeys.filter((key) => !declared.has(key));
    const unexpected = declaredKeys.filter(
      (key) =>
        !Object.prototype.hasOwnProperty.call(
          ROTATING_REQUIREMENT_CONTRACT,
          key,
        ),
    );
    const missingFields = expectedKeys.flatMap((key) => {
      const requirement = declared.get(key);
      if (!requirement) return [];
      return ROTATING_REQUIREMENT_CONTRACT[key].fields
        .filter((field) => !hasOwnPath(requirement, field))
        .map(
          (field) =>
            `${key}.${field} (${ROTATING_REQUIREMENT_CONTRACT[key].consumer})`,
        );
    });

    assert.deepEqual({ missing, unexpected, missingFields }, {
      missing: [],
      unexpected: [],
      missingFields: [],
    });
    assert.equal(hasOwnPath(rotatingPartnerConfig, "format"), true);
    assert.equal(
      hasOwnPath(
        rotatingPartnerConfig,
        "defaults.capacity.minParticipants",
      ),
      true,
    );
    assert.equal(
      hasOwnPath(
        rotatingPartnerConfig,
        "defaults.capacity.maxParticipants",
      ),
      true,
    );
  });

  it("contains the rotating rules and defaults used by the application", () => {
    assert.equal(rotatingPartnerConfig.format, "rotating");
    assert.deepEqual(rotatingPartnerConfig.defaults.capacity, {
      minParticipants: 4,
      maxParticipants: 16,
    });
    for (const key of Object.keys(ROTATING_REQUIREMENT_CONTRACT)) {
      assert.equal(getRotatingPartnerRequirement(key).key, key);
    }
  });

  it("rejects malformed documents in both schema and runtime loading", () => {
    const invalidCases: Array<{
      name: string;
      mutate: (document: any) => void;
    }> = [
      {
        name: "unknown requirement key",
        mutate(document) {
          document.requirements[0].key = "participant_registraton";
        },
      },
      {
        name: "missing requirement",
        mutate(document) {
          document.requirements.pop();
        },
      },
      {
        name: "unexpected requirement property",
        mutate(document) {
          document.requirements[0].unexpectedRuleMetadata = true;
        },
      },
      {
        name: "unknown capacity operation",
        mutate(document) {
          document.requirements
            .find(
              (requirement: any) =>
                requirement.key === "capacity_enforcement",
            )
            .condition.operations.push("capacity_override");
        },
      },
      {
        name: "invalid lock namespace",
        mutate(document) {
          document.requirements.find(
            (requirement: any) =>
              requirement.key === "capacity_write_serialization",
          ).lockNamespace = "different-lock";
        },
      },
      {
        name: "unexpected nested policy property",
        mutate(document) {
          document.requirements.find(
            (requirement: any) => requirement.key === "cancellation",
          ).policy.unexpected = true;
        },
      },
    ];
    const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
    const validate = ajv.compile(rotatingPartnerConfigSchema);

    for (const invalidCase of invalidCases) {
      const document = structuredClone(rotatingPartnerConfigDocument);
      invalidCase.mutate(document);
      assert.equal(
        validate(document),
        false,
        `${invalidCase.name} should fail JSON Schema validation`,
      );
      assert.throws(
        () => loadRotatingPartnerConfig(document),
        Error,
        `${invalidCase.name} should fail runtime loading`,
      );
    }
  });

  it("rejects duplicate IDs and semantically invalid defaults at runtime", () => {
    const duplicateId = structuredClone(rotatingPartnerConfigDocument);
    duplicateId.requirements[1].id = duplicateId.requirements[0].id;
    assert.throws(
      () => loadRotatingPartnerConfig(duplicateId),
      /requirement UUIDs must be unique/,
    );

    const invertedDefaults = structuredClone(rotatingPartnerConfigDocument);
    invertedDefaults.defaults.capacity.minParticipants = 20;
    invertedDefaults.defaults.capacity.maxParticipants = 10;
    assert.throws(
      () => loadRotatingPartnerConfig(invertedDefaults),
      /invalid defaults/,
    );
  });

  it("fails clearly when a required rule is missing", () => {
    assert.throws(
      () => getRotatingPartnerRequirement("missing-rule"),
      /Rotating-partner requirement "missing-rule" is not configured/,
    );
  });
});