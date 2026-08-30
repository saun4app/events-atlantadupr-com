export interface RotatingPartnerRequirementCondition {
  eventFormat: "rotating";
  operation?: string;
  operations?: string[];
  ratingTypes?: string[];
  publicRequest?: boolean;
  approvalMode?: string;
}

interface RotatingPartnerRequirementBase<Key extends string> {
  id: string;
  key: Key;
  condition: RotatingPartnerRequirementCondition;
  [key: string]: unknown;
}

export interface ParticipantRegistrationRequirement
  extends RotatingPartnerRequirementBase<"participant_registration"> {
  required: true;
  acceptedIdentifiers: string[];
}

export interface ParticipantCapacityRequirement
  extends RotatingPartnerRequirementBase<"participant_capacity"> {
  capacityUnit: "participant";
  capacityField: "maxParticipants";
  countedStatus: "confirmed";
  registrationRepresents: "participant";
}

export type RotatingPartnerCapacityOperation =
  | "registration_create"
  | "registration_reactivate"
  | "approval"
  | "waitlist_promotion"
  | "roster_edit";

export type RotatingPartnerFullCapacityAction = "waitlisted" | "reject";

export interface RotatingPartnerCapacityBehavior {
  waitlistEnabled: RotatingPartnerFullCapacityAction;
  waitlistDisabled: "reject";
}

export interface CapacityDefaultsRequirement
  extends RotatingPartnerRequirementBase<"capacity_defaults"> {
  defaultsPath: "defaults.capacity";
}

export interface CapacityEnforcementRequirement
  extends RotatingPartnerRequirementBase<"capacity_enforcement"> {
  condition: RotatingPartnerRequirementCondition & {
    operations: RotatingPartnerCapacityOperation[];
  };
  capacityUnit: "participant";
  capacityField: "maxParticipants";
  countedStatus: "confirmed";
  approvalPrecedesCapacity: true;
  fullCapacityActions: Record<
    RotatingPartnerCapacityOperation,
    RotatingPartnerCapacityBehavior
  >;
}

export interface ActiveRegistrationRequirement
  extends RotatingPartnerRequirementBase<"active_registration"> {
  condition: RotatingPartnerRequirementCondition & {
    operations: RotatingPartnerCapacityOperation[];
  };
  scope: "event";
  activeStatuses: string[];
}

export interface CapacityWriteSerializationRequirement
  extends RotatingPartnerRequirementBase<"capacity_write_serialization"> {
  condition: RotatingPartnerRequirementCondition & {
    operations: RotatingPartnerCapacityOperation[];
  };
  lockStrategy: "postgres_advisory_xact";
  lockScope: "event";
  lockNamespace: "atl-dupr:rotating";
}

export interface SelfRatingInputRequirement
  extends RotatingPartnerRequirementBase<"self_rating_input"> {
  condition: RotatingPartnerRequirementCondition & {
    operation: "registration_create";
    ratingTypes: string[];
    publicRequest: true;
  };
  required: true;
  valueSource: "request.selfRating";
  validationSource: "event.ratingConfig";
  snapshotPath: "playerSnapshot.selfRating";
}

export interface RatingEnforcementRequirement
  extends RotatingPartnerRequirementBase<"rating_enforcement"> {
  condition: RotatingPartnerRequirementCondition & {
    operation: "registration_create";
    ratingTypes: string[];
    approvalMode: "enforce_rating";
  };
  staffBypassRequiresExplicitFlag: true;
  nrUsesEventConfiguration: true;
  rangeSource: "event.ratingConfig";
}

export type RotatingPartnerRequirement =
  | ParticipantRegistrationRequirement
  | ParticipantCapacityRequirement
  | CapacityDefaultsRequirement
  | CapacityEnforcementRequirement
  | ActiveRegistrationRequirement
  | CapacityWriteSerializationRequirement
  | SelfRatingInputRequirement
  | RatingEnforcementRequirement;

export type RotatingPartnerRequirementKey = RotatingPartnerRequirement["key"];

export interface RotatingPartnerRequirementByKey {
  participant_registration: ParticipantRegistrationRequirement;
  participant_capacity: ParticipantCapacityRequirement;
  capacity_defaults: CapacityDefaultsRequirement;
  capacity_enforcement: CapacityEnforcementRequirement;
  active_registration: ActiveRegistrationRequirement;
  capacity_write_serialization: CapacityWriteSerializationRequirement;
  self_rating_input: SelfRatingInputRequirement;
  rating_enforcement: RatingEnforcementRequirement;
}

export interface RotatingPartnerConfig {
  version: 1;
  format: "rotating";
  defaults: {
    capacity: {
      minParticipants: number;
      maxParticipants: number;
    };
  };
  requirements: RotatingPartnerRequirement[];
}

const ROTATING_PARTNER_REQUIREMENT_KEYS = [
  "participant_registration",
  "participant_capacity",
  "capacity_defaults",
  "capacity_enforcement",
  "active_registration",
  "capacity_write_serialization",
  "self_rating_input",
  "rating_enforcement",
] as const satisfies readonly RotatingPartnerRequirementKey[];

const REQUIREMENT_FIELDS_BY_KEY: Record<
  RotatingPartnerRequirementKey,
  readonly string[]
> = {
  participant_registration: ["required", "acceptedIdentifiers"],
  participant_capacity: [
    "capacityUnit",
    "capacityField",
    "countedStatus",
    "registrationRepresents",
  ],
  capacity_defaults: ["defaultsPath"],
  capacity_enforcement: [
    "capacityUnit",
    "capacityField",
    "countedStatus",
    "approvalPrecedesCapacity",
    "fullCapacityActions",
  ],
  active_registration: ["scope", "activeStatuses"],
  capacity_write_serialization: [
    "lockStrategy",
    "lockScope",
    "lockNamespace",
  ],
  self_rating_input: [
    "required",
    "valueSource",
    "validationSource",
    "snapshotPath",
  ],
  rating_enforcement: [
    "staffBypassRequiresExplicitFlag",
    "nrUsesEventConfiguration",
    "rangeSource",
  ],
};

const CONDITION_FIELDS_BY_KEY: Record<
  RotatingPartnerRequirementKey,
  readonly string[]
> = {
  participant_registration: ["operations"],
  participant_capacity: [],
  capacity_defaults: [],
  capacity_enforcement: ["operations"],
  active_registration: ["operations"],
  capacity_write_serialization: ["operations"],
  self_rating_input: ["operation", "ratingTypes", "publicRequest"],
  rating_enforcement: ["operation", "ratingTypes", "approvalMode"],
};

function isShortUuid(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}$/.test(value);
}

function hasOnlyKeys(
  value: object,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasAllKeys(value: object, keys: readonly string[]): boolean {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function hasExactValues(
  value: unknown,
  expected: readonly string[],
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((entry) => typeof entry === "string") &&
    new Set(value).size === value.length &&
    expected.every((entry) => value.includes(entry))
  );
}

function hasExactOperations(
  value: unknown,
  expected: readonly RotatingPartnerCapacityOperation[],
): value is RotatingPartnerCapacityOperation[] {
  return hasExactValues(value, expected);
}

export function loadRotatingPartnerConfig(
  value: unknown,
): RotatingPartnerConfig {
  if (!value || typeof value !== "object") {
    throw new Error("Rotating-partner configuration must be an object");
  }

  const config = value as Partial<RotatingPartnerConfig>;
  if (config.version !== 1 || config.format !== "rotating") {
    throw new Error(
      "Rotating-partner configuration has an unsupported version or format",
    );
  }

  const capacity = config.defaults?.capacity;
  if (
    !capacity ||
    !Number.isInteger(capacity.minParticipants) ||
    !Number.isInteger(capacity.maxParticipants) ||
    capacity.minParticipants < 1 ||
    capacity.maxParticipants < capacity.minParticipants
  ) {
    throw new Error("Rotating-partner configuration has invalid defaults");
  }

  if (
    !Array.isArray(config.requirements) ||
    config.requirements.length === 0 ||
    config.requirements.some(
      (requirement) =>
        !requirement ||
        !isShortUuid(requirement.id) ||
        typeof requirement.key !== "string" ||
        requirement.condition?.eventFormat !== "rotating",
    )
  ) {
    throw new Error(
      "Rotating-partner requirements must have unique short UUIDs and rotating conditions",
    );
  }

  const ids = config.requirements.map((requirement) => requirement.id);
  const keys = config.requirements.map((requirement) => requirement.key);
  if (new Set(ids).size !== ids.length) {
    throw new Error(
      "Rotating-partner requirement UUIDs must be unique",
    );
  }
  if (
    new Set(keys).size !== keys.length ||
    !hasExactValues(keys, ROTATING_PARTNER_REQUIREMENT_KEYS)
  ) {
    throw new Error(
      "Rotating-partner configuration must contain the exact supported requirement inventory",
    );
  }

  for (const requirement of config.requirements) {
    const key = requirement.key as RotatingPartnerRequirementKey;
    if (
      !hasOnlyKeys(requirement, [
        "id",
        "key",
        "condition",
        ...REQUIREMENT_FIELDS_BY_KEY[key],
      ]) ||
      !hasOnlyKeys(requirement.condition, [
        "eventFormat",
        ...CONDITION_FIELDS_BY_KEY[key],
      ]) ||
      !hasAllKeys(requirement, REQUIREMENT_FIELDS_BY_KEY[key]) ||
      !hasAllKeys(requirement.condition, CONDITION_FIELDS_BY_KEY[key])
    ) {
      throw new Error(
        `Rotating-partner requirement ${key} contains unexpected or missing fields`,
      );
    }
  }

  const byKey = new Map(
    config.requirements.map((requirement) => [requirement.key, requirement]),
  );
  const participantRegistration = byKey.get(
    "participant_registration",
  ) as ParticipantRegistrationRequirement;
  if (
    participantRegistration.required !== true ||
    !hasExactValues(participantRegistration.acceptedIdentifiers, [
      "email",
      "memberDuprId",
    ]) ||
    !hasExactOperations(participantRegistration.condition.operations, [
      "registration_create",
      "registration_reactivate",
    ])
  ) {
    throw new Error(
      "Rotating-partner participant-registration requirement is invalid",
    );
  }

  const participantCapacity = byKey.get(
    "participant_capacity",
  ) as ParticipantCapacityRequirement;
  if (
    participantCapacity.capacityUnit !== "participant" ||
    participantCapacity.capacityField !== "maxParticipants" ||
    participantCapacity.countedStatus !== "confirmed" ||
    participantCapacity.registrationRepresents !== "participant"
  ) {
    throw new Error(
      "Rotating-partner participant-capacity requirement is invalid",
    );
  }

  const capacityDefaults = byKey.get(
    "capacity_defaults",
  ) as CapacityDefaultsRequirement;
  if (capacityDefaults.defaultsPath !== "defaults.capacity") {
    throw new Error(
      "Rotating-partner capacity-defaults requirement is invalid",
    );
  }

  const capacityEnforcement = byKey.get(
    "capacity_enforcement",
  ) as CapacityEnforcementRequirement;
  const capacityOperations: RotatingPartnerCapacityOperation[] = [
    "registration_create",
    "registration_reactivate",
    "approval",
    "waitlist_promotion",
    "roster_edit",
  ];
  if (
    capacityEnforcement.capacityUnit !== "participant" ||
    capacityEnforcement.capacityField !== "maxParticipants" ||
    capacityEnforcement.countedStatus !== "confirmed" ||
    capacityEnforcement.approvalPrecedesCapacity !== true ||
    !hasExactOperations(
      capacityEnforcement.condition.operations,
      capacityOperations,
    ) ||
    capacityOperations.some((operation) => {
      const behavior = capacityEnforcement.fullCapacityActions[operation];
      return (
        !behavior ||
        !["waitlisted", "reject"].includes(behavior.waitlistEnabled) ||
        behavior.waitlistDisabled !== "reject"
      );
    })
  ) {
    throw new Error(
      "Rotating-partner capacity-enforcement requirement is invalid",
    );
  }

  const activeRegistration = byKey.get(
    "active_registration",
  ) as ActiveRegistrationRequirement;
  if (
    activeRegistration.scope !== "event" ||
    !hasExactValues(activeRegistration.activeStatuses, [
      "confirmed",
      "waitlisted",
      "pending_approval",
    ]) ||
    !hasExactOperations(activeRegistration.condition.operations, [
      "registration_create",
      "registration_reactivate",
    ])
  ) {
    throw new Error(
      "Rotating-partner active-registration requirement is invalid",
    );
  }

  const capacitySerialization = byKey.get(
    "capacity_write_serialization",
  ) as CapacityWriteSerializationRequirement;
  if (
    capacitySerialization.lockStrategy !== "postgres_advisory_xact" ||
    capacitySerialization.lockScope !== "event" ||
    capacitySerialization.lockNamespace !== "atl-dupr:rotating" ||
    !hasExactOperations(
      capacitySerialization.condition.operations,
      capacityOperations,
    )
  ) {
    throw new Error(
      "Rotating-partner capacity serialization requirement is invalid",
    );
  }

  const selfRatingInput = byKey.get(
    "self_rating_input",
  ) as SelfRatingInputRequirement;
  if (
    selfRatingInput.required !== true ||
    selfRatingInput.valueSource !== "request.selfRating" ||
    selfRatingInput.validationSource !== "event.ratingConfig" ||
    selfRatingInput.snapshotPath !== "playerSnapshot.selfRating" ||
    selfRatingInput.condition.operation !== "registration_create" ||
    !hasExactValues(selfRatingInput.condition.ratingTypes, [
      "self_numeric",
      "self_skill",
    ]) ||
    selfRatingInput.condition.publicRequest !== true
  ) {
    throw new Error(
      "Rotating-partner self-rating-input requirement is invalid",
    );
  }

  const ratingEnforcement = byKey.get(
    "rating_enforcement",
  ) as RatingEnforcementRequirement;
  if (
    ratingEnforcement.staffBypassRequiresExplicitFlag !== true ||
    ratingEnforcement.nrUsesEventConfiguration !== true ||
    ratingEnforcement.rangeSource !== "event.ratingConfig" ||
    ratingEnforcement.condition.operation !== "registration_create" ||
    !hasExactValues(ratingEnforcement.condition.ratingTypes, [
      "dupr",
      "self_numeric",
    ]) ||
    ratingEnforcement.condition.approvalMode !== "enforce_rating"
  ) {
    throw new Error(
      "Rotating-partner rating-enforcement requirement is invalid",
    );
  }

  return config as RotatingPartnerConfig;
}

export function getRotatingPartnerRequirement<
  Key extends RotatingPartnerRequirementKey,
>(
  config: RotatingPartnerConfig,
  key: Key,
): RotatingPartnerRequirementByKey[Key];
export function getRotatingPartnerRequirement(
  config: RotatingPartnerConfig,
  key: string,
): RotatingPartnerRequirement;
export function getRotatingPartnerRequirement(
  config: RotatingPartnerConfig,
  key: string,
): RotatingPartnerRequirement {
  const requirement = config.requirements.find((entry) => entry.key === key);
  if (!requirement) {
    throw new Error(
      `Rotating-partner requirement "${key}" is not configured`,
    );
  }
  return requirement;
}