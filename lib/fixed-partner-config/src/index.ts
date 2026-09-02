export interface FixedPartnerRequirementCondition {
  eventFormat: "fixed_partner";
  operation?: string;
  operations?: string[];
  ratingTypes?: string[];
  ratingType?: string;
  approvalMode?: string;
  resolvedPartner?: boolean;
  bothEffectiveRatings?: boolean;
  nrAllowed?: boolean;
  publicRequest?: boolean;
  adminAdd?: boolean;
  publicSignup?: boolean;
}

interface FixedPartnerRequirementBase<Key extends string> {
  id: string;
  key: Key;
  condition: FixedPartnerRequirementCondition;
  [key: string]: unknown;
}

export interface PartnerRegistrationRequirement
  extends FixedPartnerRequirementBase<"partner_registration"> {
  required: boolean;
  acceptedIdentifiers: string[];
}

export interface TeamCapacityRequirement
  extends FixedPartnerRequirementBase<"team_capacity"> {
  playersPerTeam: number;
  registrationRepresents: string;
}

export type FixedPartnerCapacityDecisionOperation =
  | "registration_create"
  | "registration_reactivate"
  | "approval"
  | "waitlist_promotion"
  | "roster_edit";

export type FixedPartnerCapacityWriteOperation =
  | FixedPartnerCapacityDecisionOperation
  | "event_limit_update";

export type FixedPartnerFullCapacityAction = "waitlisted" | "reject";

export interface FixedPartnerFullCapacityBehavior {
  waitlistEnabled: FixedPartnerFullCapacityAction;
  waitlistDisabled: "reject";
}

export interface TeamCapacityEnforcementRequirement
  extends FixedPartnerRequirementBase<"team_capacity_enforcement"> {
  condition: FixedPartnerRequirementCondition & {
    operations: FixedPartnerCapacityDecisionOperation[];
  };
  capacityUnit: "team";
  capacityField: "maxTeams";
  countedStatus: "confirmed";
  fullCapacityActions: Record<
    FixedPartnerCapacityDecisionOperation,
    FixedPartnerFullCapacityBehavior
  >;
}

export interface EventLimitSafetyRequirement
  extends FixedPartnerRequirementBase<"event_limit_safety"> {
  condition: FixedPartnerRequirementCondition & {
    operation: "event_limit_update";
  };
  limitField: "maxTeams";
  minimumSource: "confirmed_team_count";
  onConflict: "reject";
}

export interface CapacityDefaultsRequirement
  extends FixedPartnerRequirementBase<"capacity_defaults"> {
  defaultsPath: string;
}

export interface PartnerRatingGapRequirement
  extends FixedPartnerRequirementBase<"partner_rating_gap"> {
  condition: FixedPartnerRequirementCondition & {
    ratingType: string;
    approvalMode: string;
    resolvedPartner: boolean;
    bothEffectiveRatings: boolean;
  };
  comparison: string;
  fallbackPath: string;
}

export interface NrPartnerCheckRequirement
  extends FixedPartnerRequirementBase<"nr_partner_check"> {
  condition: FixedPartnerRequirementCondition & {
    ratingType: string;
    nrAllowed: boolean;
    publicRequest: boolean;
  };
  check: string;
}

export interface PartnerRatingRangeRequirement
  extends FixedPartnerRequirementBase<"partner_rating_range"> {
  condition: FixedPartnerRequirementCondition & {
    ratingType: string;
    approvalMode: string;
    resolvedPartner: boolean;
  };
  includePartner: boolean;
}

export interface AdminAddInputRequirement
  extends FixedPartnerRequirementBase<"admin_add_input"> {
  maxPrimaryEmailsPerSubmission: number;
}

export interface PublicPartnerPreflightRequirement
  extends FixedPartnerRequirementBase<"public_partner_preflight"> {
  condition: FixedPartnerRequirementCondition & {
    publicSignup: boolean;
  };
  requirePartnerBeforeCode: boolean;
}

export interface RosterEditValidationRequirement
  extends FixedPartnerRequirementBase<"roster_edit_validation"> {
  condition: FixedPartnerRequirementCondition & {
    operation: string;
    ratingTypes: string[];
    approvalMode: string;
    resolvedPartner: boolean;
  };
  checks: string[];
  staffBypass: boolean;
}

export interface ActiveTeamMembershipRequirement
  extends FixedPartnerRequirementBase<"active_team_membership"> {
  condition: FixedPartnerRequirementCondition & {
    operations: string[];
  };
  scope: string;
  membershipRoles: string[];
  activeStatuses: string[];
  excludeCurrentRegistrationOnEdit: boolean;
}

export interface MembershipWriteSerializationRequirement
  extends FixedPartnerRequirementBase<"membership_write_serialization"> {
  condition: FixedPartnerRequirementCondition & {
    operations: string[];
  };
  lockStrategy: string;
  lockScope: string;
  lockNamespace: string;
}

export interface CapacityWriteSerializationRequirement
  extends FixedPartnerRequirementBase<"capacity_write_serialization"> {
  condition: FixedPartnerRequirementCondition & {
    operations: FixedPartnerCapacityWriteOperation[];
  };
  lockStrategy: "postgres_advisory_xact";
  lockScope: "event";
  lockNamespace: string;
}

export type FixedPartnerRequirement =
  | PartnerRegistrationRequirement
  | TeamCapacityRequirement
  | TeamCapacityEnforcementRequirement
  | EventLimitSafetyRequirement
  | CapacityDefaultsRequirement
  | PartnerRatingGapRequirement
  | NrPartnerCheckRequirement
  | PartnerRatingRangeRequirement
  | AdminAddInputRequirement
  | PublicPartnerPreflightRequirement
  | RosterEditValidationRequirement
  | ActiveTeamMembershipRequirement
  | MembershipWriteSerializationRequirement
  | CapacityWriteSerializationRequirement;

export type FixedPartnerRequirementKey = FixedPartnerRequirement["key"];

export interface FixedPartnerRequirementByKey {
  partner_registration: PartnerRegistrationRequirement;
  team_capacity: TeamCapacityRequirement;
  team_capacity_enforcement: TeamCapacityEnforcementRequirement;
  event_limit_safety: EventLimitSafetyRequirement;
  capacity_defaults: CapacityDefaultsRequirement;
  partner_rating_gap: PartnerRatingGapRequirement;
  nr_partner_check: NrPartnerCheckRequirement;
  partner_rating_range: PartnerRatingRangeRequirement;
  admin_add_input: AdminAddInputRequirement;
  public_partner_preflight: PublicPartnerPreflightRequirement;
  roster_edit_validation: RosterEditValidationRequirement;
  active_team_membership: ActiveTeamMembershipRequirement;
  membership_write_serialization: MembershipWriteSerializationRequirement;
  capacity_write_serialization: CapacityWriteSerializationRequirement;
}

const FIXED_PARTNER_REQUIREMENT_KEYS = [
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
] as const satisfies readonly FixedPartnerRequirementKey[];

const REQUIREMENT_FIELDS_BY_KEY: Record<
  FixedPartnerRequirementKey,
  readonly string[]
> = {
  partner_registration: ["required", "acceptedIdentifiers"],
  team_capacity: ["playersPerTeam", "registrationRepresents"],
  team_capacity_enforcement: [
    "capacityUnit",
    "capacityField",
    "countedStatus",
    "fullCapacityActions",
  ],
  event_limit_safety: ["limitField", "minimumSource", "onConflict"],
  capacity_defaults: ["defaultsPath"],
  partner_rating_gap: ["comparison", "fallbackPath"],
  nr_partner_check: ["check"],
  partner_rating_range: ["includePartner"],
  admin_add_input: ["maxPrimaryEmailsPerSubmission"],
  public_partner_preflight: ["requirePartnerBeforeCode"],
  roster_edit_validation: ["checks", "staffBypass"],
  active_team_membership: [
    "scope",
    "membershipRoles",
    "activeStatuses",
    "excludeCurrentRegistrationOnEdit",
  ],
  membership_write_serialization: [
    "lockStrategy",
    "lockScope",
    "lockNamespace",
  ],
  capacity_write_serialization: [
    "lockStrategy",
    "lockScope",
    "lockNamespace",
  ],
};

const CONDITION_FIELDS_BY_KEY: Record<
  FixedPartnerRequirementKey,
  readonly string[]
> = {
  partner_registration: [],
  team_capacity: [],
  team_capacity_enforcement: ["operations"],
  event_limit_safety: ["operation"],
  capacity_defaults: [],
  partner_rating_gap: [
    "ratingType",
    "approvalMode",
    "resolvedPartner",
    "bothEffectiveRatings",
  ],
  nr_partner_check: ["ratingType", "nrAllowed", "publicRequest"],
  partner_rating_range: [
    "ratingType",
    "approvalMode",
    "resolvedPartner",
  ],
  admin_add_input: ["adminAdd"],
  public_partner_preflight: ["publicSignup"],
  roster_edit_validation: [
    "operation",
    "ratingTypes",
    "approvalMode",
    "resolvedPartner",
  ],
  active_team_membership: ["operations"],
  membership_write_serialization: ["operations"],
  capacity_write_serialization: ["operations"],
};

export interface FixedPartnerConfig {
  version: 1;
  format: "fixed_partner";
  defaults: {
    capacity: {
      minTeams: number;
      maxTeams: number;
      minParticipants: number;
      maxParticipants: number;
    };
    rating: {
      maxPartnerGap: number;
      maxPartnerGapInput: number;
    };
  };
  requirements: FixedPartnerRequirement[];
}

function isShortUuid(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}$/.test(value);
}

function hasExactUniqueValues(
  value: unknown,
  expected: readonly string[],
): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string") &&
    new Set(value).size === value.length &&
    value.length === expected.length &&
    expected.every((entry) => value.includes(entry))
  );
}

function hasOnlyKeys(
  value: object,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasAllKeys(
  value: object,
  requiredKeys: readonly string[],
): boolean {
  return requiredKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

export function loadFixedPartnerConfig(value: unknown): FixedPartnerConfig {
  if (!value || typeof value !== "object") {
    throw new Error("Fixed-partner configuration must be an object");
  }

  const config = value as Partial<FixedPartnerConfig>;
  if (config.version !== 1 || config.format !== "fixed_partner") {
    throw new Error("Fixed-partner configuration has an unsupported version or format");
  }

  const capacity = config.defaults?.capacity;
  const rating = config.defaults?.rating;
  if (
    !capacity ||
    !Number.isInteger(capacity.minTeams) ||
    !Number.isInteger(capacity.maxTeams) ||
    !Number.isInteger(capacity.minParticipants) ||
    !Number.isInteger(capacity.maxParticipants) ||
    capacity.minTeams < 1 ||
    capacity.maxTeams < capacity.minTeams ||
    capacity.minParticipants < 2 ||
    capacity.maxParticipants < capacity.minParticipants ||
    !rating ||
    typeof rating.maxPartnerGap !== "number" ||
    !Number.isFinite(rating.maxPartnerGap) ||
    rating.maxPartnerGap < 0 ||
    typeof rating.maxPartnerGapInput !== "number" ||
    !Number.isFinite(rating.maxPartnerGapInput) ||
    rating.maxPartnerGapInput < rating.maxPartnerGap
  ) {
    throw new Error("Fixed-partner configuration has invalid defaults");
  }

  if (
    !Array.isArray(config.requirements) ||
    config.requirements.length === 0 ||
    config.requirements.some(
      (requirement) =>
        !requirement ||
        !isShortUuid(requirement.id) ||
        typeof requirement.key !== "string" ||
        requirement.condition?.eventFormat !== "fixed_partner",
    )
  ) {
    throw new Error("Fixed-partner configuration requirements must have unique short UUIDs and fixed_partner conditions");
  }

  const ids = config.requirements.map((requirement) => requirement.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Fixed-partner configuration requirement UUIDs must be unique");
  }
  const keys = config.requirements.map((requirement) => requirement.key);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Fixed-partner configuration requirement keys must be unique");
  }
  if (!hasExactUniqueValues(keys, FIXED_PARTNER_REQUIREMENT_KEYS)) {
    throw new Error(
      "Fixed-partner configuration must contain the exact supported requirement inventory",
    );
  }
  for (const requirement of config.requirements) {
    const requirementKey = requirement.key as FixedPartnerRequirementKey;
    if (
      !hasOnlyKeys(requirement, [
        "id",
        "key",
        "condition",
        ...REQUIREMENT_FIELDS_BY_KEY[requirementKey],
      ]) ||
      !hasOnlyKeys(requirement.condition, [
        "eventFormat",
        ...CONDITION_FIELDS_BY_KEY[requirementKey],
      ]) ||
      !hasAllKeys(requirement, REQUIREMENT_FIELDS_BY_KEY[requirementKey]) ||
      !hasAllKeys(
        requirement.condition,
        CONDITION_FIELDS_BY_KEY[requirementKey],
      )
    ) {
      throw new Error(
        `Fixed-partner requirement ${requirementKey} contains unexpected fields`,
      );
    }
  }

  const requirementsByKey = new Map(
    config.requirements.map((requirement) => [requirement.key, requirement]),
  );
  const partnerRegistration = requirementsByKey.get(
    "partner_registration",
  ) as PartnerRegistrationRequirement;
  if (
    partnerRegistration.required !== true ||
    !hasExactUniqueValues(partnerRegistration.acceptedIdentifiers, [
      "partnerEmail",
      "partnerDuprId",
    ])
  ) {
    throw new Error("Fixed-partner registration requirement is invalid");
  }

  const teamCapacity = requirementsByKey.get(
    "team_capacity",
  ) as TeamCapacityRequirement;
  if (
    teamCapacity.playersPerTeam !== 2 ||
    teamCapacity.registrationRepresents !== "team"
  ) {
    throw new Error("Fixed-partner team-capacity requirement is invalid");
  }

  const capacityDefaults = requirementsByKey.get(
    "capacity_defaults",
  ) as CapacityDefaultsRequirement;
  if (capacityDefaults.defaultsPath !== "defaults.capacity") {
    throw new Error("Fixed-partner capacity-defaults requirement is invalid");
  }

  const partnerGap = requirementsByKey.get(
    "partner_rating_gap",
  ) as PartnerRatingGapRequirement;
  if (
    partnerGap.condition.ratingType !== "dupr" ||
    partnerGap.condition.approvalMode !== "enforce_rating" ||
    partnerGap.condition.resolvedPartner !== true ||
    partnerGap.condition.bothEffectiveRatings !== true ||
    partnerGap.comparison !== "less_than_or_equal" ||
    partnerGap.fallbackPath !== "defaults.rating.maxPartnerGap"
  ) {
    throw new Error("Fixed-partner rating-gap requirement is invalid");
  }

  const nrPartnerCheck = requirementsByKey.get(
    "nr_partner_check",
  ) as NrPartnerCheckRequirement;
  if (
    nrPartnerCheck.condition.ratingType !== "dupr" ||
    nrPartnerCheck.condition.nrAllowed !== false ||
    nrPartnerCheck.condition.publicRequest !== true ||
    nrPartnerCheck.check !== "primary_and_partner"
  ) {
    throw new Error("Fixed-partner NR-check requirement is invalid");
  }

  const partnerRange = requirementsByKey.get(
    "partner_rating_range",
  ) as PartnerRatingRangeRequirement;
  if (
    partnerRange.condition.ratingType !== "dupr" ||
    partnerRange.condition.approvalMode !== "enforce_rating" ||
    partnerRange.condition.resolvedPartner !== true ||
    partnerRange.includePartner !== true
  ) {
    throw new Error("Fixed-partner rating-range requirement is invalid");
  }

  const adminAddInput = requirementsByKey.get(
    "admin_add_input",
  ) as AdminAddInputRequirement;
  if (
    adminAddInput.condition.adminAdd !== true ||
    adminAddInput.maxPrimaryEmailsPerSubmission !== 1
  ) {
    throw new Error("Fixed-partner admin-add requirement is invalid");
  }

  const publicPreflight = requirementsByKey.get(
    "public_partner_preflight",
  ) as PublicPartnerPreflightRequirement;
  if (
    publicPreflight.condition.publicSignup !== true ||
    publicPreflight.requirePartnerBeforeCode !== true
  ) {
    throw new Error("Fixed-partner public-preflight requirement is invalid");
  }

  const rosterEdit = requirementsByKey.get("roster_edit_validation");
  if (
    rosterEdit?.condition.operation !== "roster_edit" ||
    !hasExactUniqueValues(rosterEdit.condition.ratingTypes, [
      "dupr",
      "self_numeric",
    ]) ||
    rosterEdit.condition.approvalMode !== "enforce_rating" ||
    rosterEdit.condition.resolvedPartner !== true ||
    rosterEdit.staffBypass !== true
  ) {
    throw new Error("Fixed-partner roster-edit validation requirement is invalid");
  }
  const rosterEditChecks = rosterEdit.checks;
  if (
    !hasExactUniqueValues(rosterEditChecks, [
      "nr",
      "rating_range",
      "partner_rating_gap",
    ])
  ) {
    throw new Error("Fixed-partner roster-edit validation checks are invalid");
  }

  const membership = requirementsByKey.get("active_team_membership");
  if (
    !hasExactUniqueValues(membership?.condition.operations, [
      "registration",
      "roster_edit",
    ]) ||
    membership.scope !== "event" ||
    !hasExactUniqueValues(membership.membershipRoles, ["primary", "partner"]) ||
    !hasExactUniqueValues(membership.activeStatuses, [
      "confirmed",
      "waitlisted",
      "pending_approval",
    ]) ||
    membership.excludeCurrentRegistrationOnEdit !== true
  ) {
    throw new Error("Fixed-partner active team membership requirement is invalid");
  }

  const serialization = requirementsByKey.get("membership_write_serialization");
  if (
    !hasExactUniqueValues(serialization?.condition.operations, [
      "registration_create",
      "registration_reactivate",
      "roster_edit",
    ]) ||
    serialization.lockStrategy !== "postgres_advisory_xact" ||
    serialization.lockScope !== "event" ||
    typeof serialization.lockNamespace !== "string" ||
    serialization.lockNamespace.length === 0
  ) {
    throw new Error("Fixed-partner membership-write serialization requirement is invalid");
  }

  const capacityOperations: FixedPartnerCapacityDecisionOperation[] = [
    "registration_create",
    "registration_reactivate",
    "approval",
    "waitlist_promotion",
    "roster_edit",
  ];
  const capacityEnforcement = requirementsByKey.get(
    "team_capacity_enforcement",
  ) as TeamCapacityEnforcementRequirement | undefined;
  if (
    !hasExactUniqueValues(
      capacityEnforcement?.condition.operations,
      capacityOperations,
    ) ||
    capacityEnforcement.capacityUnit !== "team" ||
    capacityEnforcement.capacityField !== "maxTeams" ||
    capacityEnforcement.countedStatus !== "confirmed" ||
    !capacityEnforcement.fullCapacityActions ||
    typeof capacityEnforcement.fullCapacityActions !== "object" ||
    !hasOnlyKeys(capacityEnforcement.fullCapacityActions, capacityOperations)
  ) {
    throw new Error("Fixed-partner team-capacity enforcement requirement is invalid");
  }
  for (const operation of capacityOperations) {
    const action = capacityEnforcement.fullCapacityActions[operation];
    const expectedWaitlistAction =
      operation === "waitlist_promotion" ? "reject" : "waitlisted";
    if (
      !action ||
      typeof action !== "object" ||
      !hasOnlyKeys(action, ["waitlistEnabled", "waitlistDisabled"]) ||
      action?.waitlistEnabled !== expectedWaitlistAction ||
      action.waitlistDisabled !== "reject"
    ) {
      throw new Error(
        `Fixed-partner full-capacity action is invalid for ${operation}`,
      );
    }
  }

  const eventLimitSafety = requirementsByKey.get(
    "event_limit_safety",
  ) as EventLimitSafetyRequirement | undefined;
  if (
    eventLimitSafety?.condition.operation !== "event_limit_update" ||
    eventLimitSafety.limitField !== "maxTeams" ||
    eventLimitSafety.minimumSource !== "confirmed_team_count" ||
    eventLimitSafety.onConflict !== "reject"
  ) {
    throw new Error("Fixed-partner event-limit safety requirement is invalid");
  }

  const capacitySerializationOperations: FixedPartnerCapacityWriteOperation[] = [
    ...capacityOperations,
    "event_limit_update",
  ];
  const capacitySerialization = requirementsByKey.get(
    "capacity_write_serialization",
  ) as CapacityWriteSerializationRequirement | undefined;
  if (
    !hasExactUniqueValues(
      capacitySerialization?.condition.operations,
      capacitySerializationOperations,
    ) ||
    capacitySerialization.lockStrategy !== "postgres_advisory_xact" ||
    capacitySerialization.lockScope !== "event" ||
    typeof capacitySerialization.lockNamespace !== "string" ||
    capacitySerialization.lockNamespace.length === 0 ||
    capacitySerialization.lockNamespace !== serialization.lockNamespace
  ) {
    throw new Error("Fixed-partner capacity-write serialization requirement is invalid");
  }

  return config as FixedPartnerConfig;
}

export function getFixedPartnerRequirement<Key extends FixedPartnerRequirementKey>(
  config: FixedPartnerConfig,
  key: Key,
): FixedPartnerRequirementByKey[Key];
export function getFixedPartnerRequirement(
  config: FixedPartnerConfig,
  key: string,
): FixedPartnerRequirement;
export function getFixedPartnerRequirement(
  config: FixedPartnerConfig,
  key: string,
): FixedPartnerRequirement {
  const requirement = config.requirements.find((entry) => entry.key === key);
  if (!requirement) {
    throw new Error(`Missing fixed-partner requirement: ${key}`);
  }
  return requirement;
}