export interface RotatingPartnerRequirementCondition {
  eventFormat: "rotating";
  operation?: string;
  operations?: string[];
  ratingTypes?: string[];
  publicRequest?: boolean;
  approvalMode?: string;
  audience?: string;
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

export type RotatingPartnerCapacityWriteOperation =
  | RotatingPartnerCapacityOperation
  | "event_limit_update";

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

export interface EventLimitSafetyRequirement
  extends RotatingPartnerRequirementBase<"event_limit_safety"> {
  condition: RotatingPartnerRequirementCondition & {
    operation: "event_limit_update";
  };
  limitField: "maxParticipants";
  minimumSource: "confirmed_participant_count";
  onConflict: "reject";
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
    operations: RotatingPartnerCapacityWriteOperation[];
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

export interface RegistrationAccessRequirement
  extends RotatingPartnerRequirementBase<"registration_access"> {
  policy: {
    allowedEventStatuses: string[];
    publicSignupWindow: "enforced";
    staffBypass: true;
    cancelledEventAction: "reject";
  };
}

export interface PublicVerificationRequirement
  extends RotatingPartnerRequirementBase<"public_verification"> {
  policy: {
    emailRequired: true;
    verificationCodeRequired: true;
    verifier: "peek_code";
    consumeOnSuccess: true;
    codeFormat: "six_digit";
    codeTtlSeconds: 600;
    codeCooldownSeconds: 30;
    maxCodeAttempts: 5;
    senderSource: "verified_env_then_event_contact";
    replyToSource: "event_contact_when_different";
    failureAlertRecipients: "event_contacts";
    requestCodeRateLimit: {
      ip: { maxAttempts: 3; windowMs: 3600000; blockMs: 3600000 };
      email: { maxAttempts: 3; windowMs: 3600000; blockMs: 3600000 };
    };
    submissionRateLimit: {
      ip: { maxAttempts: 5; windowMs: 600000; blockMs: 900000 };
      email: { maxAttempts: 5; windowMs: 600000; blockMs: 900000 };
    };
  };
}

export interface RegistrationReactivationRequirement
  extends RotatingPartnerRequirementBase<"registration_reactivation"> {
  policy: {
    historicalRows: "all";
    candidateStatus: "cancelled";
    selection: "newest_by_id";
    updateMode: "in_place";
    blockedStatuses: string[];
    clearFields: string[];
  };
}

export interface CancellationRequirement
  extends RotatingPartnerRequirementBase<"cancellation"> {
  policy: {
    lookup: "player_snapshot_email";
    alreadyCancelledAction: "reject";
    cancelledStatus: "cancelled";
    cancelledBy: "participant";
    consumeVerificationCode: true;
  };
}

export interface StatusTransitionsRequirement
  extends RotatingPartnerRequirementBase<"status_transitions"> {
  policy: {
    statuses: string[];
    approval: {
      available: "confirmed";
      full: "waitlisted";
      setsApprovalMetadata: true;
    };
    rejection: {
      target: "rejected";
    };
    promotion: {
      target: "confirmed";
      setsApprovalMetadata: true;
    };
    cancellation: {
      target: "cancelled";
      setsCancellationMetadata: true;
    };
    reactivationClearsCancellationMetadata: true;
  };
}

export interface RegistrationSnapshotRequirement
  extends RotatingPartnerRequirementBase<"registration_snapshot"> {
  policy: {
    source: "member_at_write";
    sourceOfTruth: "registration_snapshot";
    playerFields: string[];
    partnerFields: string[];
    assignedRating: "numeric_member_doubles_or_null";
  };
}

export interface RatingValidationRequirement
  extends RotatingPartnerRequirementBase<"rating_validation"> {
  policy: {
    eventConfigSource: "event.ratingConfig";
    numericPrecision: 2;
    numericRange: "event_configured";
    skillValue: "integer_level";
    nrRange: { min: 2; max: 5 };
    nrPrecision: 2;
    missingRequiredConfig: "reject";
    staffBypassRequiresExplicitFlag: true;
  };
}

export interface EventSettingsPrecedenceRequirement
  extends RotatingPartnerRequirementBase<"event_settings_precedence"> {
  policy: {
    eventSpecificSource: "database_event";
    globalDefaultsSource: "database_event_defaults";
    jsonDefaultsRole: "initial_fallback";
    cloneSource: "source_event";
    serverAuthority: "database_event";
  };
}

export interface RosterSummaryRequirement
  extends RotatingPartnerRequirementBase<"roster_summary"> {
  policy: {
    countedStatuses: string[];
    excludedStatuses: string[];
    total: "sum_counted_statuses";
    capacitySource: "event.maxParticipants";
    teamFields: "null_for_rotating";
  };
}

export type RotatingPartnerRequirement =
  | ParticipantRegistrationRequirement
  | ParticipantCapacityRequirement
  | CapacityDefaultsRequirement
  | CapacityEnforcementRequirement
  | EventLimitSafetyRequirement
  | ActiveRegistrationRequirement
  | CapacityWriteSerializationRequirement
  | SelfRatingInputRequirement
  | RatingEnforcementRequirement
  | RegistrationAccessRequirement
  | PublicVerificationRequirement
  | RegistrationReactivationRequirement
  | CancellationRequirement
  | StatusTransitionsRequirement
  | RegistrationSnapshotRequirement
  | RatingValidationRequirement
  | EventSettingsPrecedenceRequirement
  | RosterSummaryRequirement;

export type RotatingPartnerRequirementKey = RotatingPartnerRequirement["key"];

export interface RotatingPartnerRequirementByKey {
  participant_registration: ParticipantRegistrationRequirement;
  participant_capacity: ParticipantCapacityRequirement;
  capacity_defaults: CapacityDefaultsRequirement;
  capacity_enforcement: CapacityEnforcementRequirement;
  event_limit_safety: EventLimitSafetyRequirement;
  active_registration: ActiveRegistrationRequirement;
  capacity_write_serialization: CapacityWriteSerializationRequirement;
  self_rating_input: SelfRatingInputRequirement;
  rating_enforcement: RatingEnforcementRequirement;
  registration_access: RegistrationAccessRequirement;
  public_verification: PublicVerificationRequirement;
  registration_reactivation: RegistrationReactivationRequirement;
  cancellation: CancellationRequirement;
  status_transitions: StatusTransitionsRequirement;
  registration_snapshot: RegistrationSnapshotRequirement;
  rating_validation: RatingValidationRequirement;
  event_settings_precedence: EventSettingsPrecedenceRequirement;
  roster_summary: RosterSummaryRequirement;
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
  "event_limit_safety",
  "active_registration",
  "capacity_write_serialization",
  "self_rating_input",
  "rating_enforcement",
  "registration_access",
  "public_verification",
  "registration_reactivation",
  "cancellation",
  "status_transitions",
  "registration_snapshot",
  "rating_validation",
  "event_settings_precedence",
  "roster_summary",
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
  event_limit_safety: ["limitField", "minimumSource", "onConflict"],
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
  registration_access: ["policy"],
  public_verification: ["policy"],
  registration_reactivation: ["policy"],
  cancellation: ["policy"],
  status_transitions: ["policy"],
  registration_snapshot: ["policy"],
  rating_validation: ["policy"],
  event_settings_precedence: ["policy"],
  roster_summary: ["policy"],
};

const CONDITION_FIELDS_BY_KEY: Record<
  RotatingPartnerRequirementKey,
  readonly string[]
> = {
  participant_registration: ["operations"],
  participant_capacity: [],
  capacity_defaults: [],
  capacity_enforcement: ["operations"],
  event_limit_safety: ["operation"],
  active_registration: ["operations"],
  capacity_write_serialization: ["operations"],
  self_rating_input: ["operation", "ratingTypes", "publicRequest"],
  rating_enforcement: ["operation", "ratingTypes", "approvalMode"],
  registration_access: ["operations", "audience"],
  public_verification: ["operations", "publicRequest"],
  registration_reactivation: ["operation"],
  cancellation: ["operation", "publicRequest"],
  status_transitions: ["operations"],
  registration_snapshot: ["operations"],
  rating_validation: ["operation", "ratingTypes"],
  event_settings_precedence: ["operations"],
  roster_summary: ["operation"],
};

const POLICY_FIELDS_BY_KEY: Record<
  | "registration_access"
  | "public_verification"
  | "registration_reactivation"
  | "cancellation"
  | "status_transitions"
  | "registration_snapshot"
  | "rating_validation"
  | "event_settings_precedence"
  | "roster_summary",
  readonly string[]
> = {
  registration_access: [
    "allowedEventStatuses",
    "publicSignupWindow",
    "staffBypass",
    "cancelledEventAction",
  ],
  public_verification: [
    "emailRequired",
    "verificationCodeRequired",
    "verifier",
    "consumeOnSuccess",
    "codeFormat",
    "codeTtlSeconds",
    "codeCooldownSeconds",
    "maxCodeAttempts",
    "senderSource",
    "replyToSource",
    "failureAlertRecipients",
    "requestCodeRateLimit",
    "submissionRateLimit",
  ],
  registration_reactivation: [
    "historicalRows",
    "candidateStatus",
    "selection",
    "updateMode",
    "blockedStatuses",
    "clearFields",
  ],
  cancellation: [
    "lookup",
    "alreadyCancelledAction",
    "cancelledStatus",
    "cancelledBy",
    "consumeVerificationCode",
  ],
  status_transitions: [
    "statuses",
    "approval",
    "rejection",
    "promotion",
    "cancellation",
    "reactivationClearsCancellationMetadata",
  ],
  registration_snapshot: [
    "source",
    "sourceOfTruth",
    "playerFields",
    "partnerFields",
    "assignedRating",
  ],
  rating_validation: [
    "eventConfigSource",
    "numericPrecision",
    "numericRange",
    "skillValue",
    "nrRange",
    "nrPrecision",
    "missingRequiredConfig",
    "staffBypassRequiresExplicitFlag",
  ],
  event_settings_precedence: [
    "eventSpecificSource",
    "globalDefaultsSource",
    "jsonDefaultsRole",
    "cloneSource",
    "serverAuthority",
  ],
  roster_summary: [
    "countedStatuses",
    "excludedStatuses",
    "total",
    "capacitySource",
    "teamFields",
  ],
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
  expected: readonly string[],
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
    if (
      key in POLICY_FIELDS_BY_KEY &&
      (!requirement.policy ||
        typeof requirement.policy !== "object" ||
        !hasOnlyKeys(
          requirement.policy as object,
          POLICY_FIELDS_BY_KEY[key as keyof typeof POLICY_FIELDS_BY_KEY],
        ))
    ) {
      throw new Error(
        `Rotating-partner requirement ${key} contains unexpected policy fields`,
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

  const eventLimitSafety = byKey.get(
    "event_limit_safety",
  ) as EventLimitSafetyRequirement;
  if (
    eventLimitSafety.condition.operation !== "event_limit_update" ||
    eventLimitSafety.limitField !== "maxParticipants" ||
    eventLimitSafety.minimumSource !== "confirmed_participant_count" ||
    eventLimitSafety.onConflict !== "reject"
  ) {
    throw new Error(
      "Rotating-partner event-limit safety requirement is invalid",
    );
  }

  const capacitySerialization = byKey.get(
    "capacity_write_serialization",
  ) as CapacityWriteSerializationRequirement;
  const capacitySerializationOperations: RotatingPartnerCapacityWriteOperation[] = [
    ...capacityOperations,
    "event_limit_update",
  ];
  if (
    capacitySerialization.lockStrategy !== "postgres_advisory_xact" ||
    capacitySerialization.lockScope !== "event" ||
    capacitySerialization.lockNamespace !== "atl-dupr:rotating" ||
    !hasExactOperations(
      capacitySerialization.condition.operations,
      capacitySerializationOperations,
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

  const policyRequirements = [
    "registration_access",
    "public_verification",
    "registration_reactivation",
    "cancellation",
    "status_transitions",
    "registration_snapshot",
    "rating_validation",
    "event_settings_precedence",
    "roster_summary",
  ] as const;
  for (const key of policyRequirements) {
    const requirement = byKey.get(key) as { policy?: unknown } | undefined;
    if (!requirement?.policy || typeof requirement.policy !== "object") {
      throw new Error(
        `Rotating-partner ${key} requirement must contain a policy object`,
      );
    }
  }

  const registrationAccess = byKey.get(
    "registration_access",
  ) as RegistrationAccessRequirement;
  if (
    !hasExactValues(registrationAccess.condition.operations, [
      "registration_create",
      "registration_reactivate",
    ]) ||
    registrationAccess.condition.audience !== "public_and_staff" ||
    !hasExactValues(registrationAccess.policy.allowedEventStatuses, ["upcoming"]) ||
    registrationAccess.policy.publicSignupWindow !== "enforced" ||
    registrationAccess.policy.staffBypass !== true ||
    registrationAccess.policy.cancelledEventAction !== "reject"
  ) {
    throw new Error("Rotating-partner registration-access requirement is invalid");
  }

  const publicVerification = byKey.get(
    "public_verification",
  ) as PublicVerificationRequirement;
  if (
    !hasExactOperations(publicVerification.condition.operations, [
      "request_code",
      "registration_create",
      "registration_cancel",
    ]) ||
    publicVerification.condition.publicRequest !== true ||
    publicVerification.policy.emailRequired !== true ||
    publicVerification.policy.verificationCodeRequired !== true ||
    publicVerification.policy.verifier !== "peek_code" ||
    publicVerification.policy.consumeOnSuccess !== true ||
    publicVerification.policy.codeFormat !== "six_digit" ||
    publicVerification.policy.codeTtlSeconds !== 600 ||
    publicVerification.policy.codeCooldownSeconds !== 30 ||
    publicVerification.policy.maxCodeAttempts !== 5 ||
    publicVerification.policy.senderSource !== "verified_env_then_event_contact" ||
    publicVerification.policy.replyToSource !== "event_contact_when_different" ||
    publicVerification.policy.failureAlertRecipients !== "event_contacts"
  ) {
    throw new Error("Rotating-partner public-verification requirement is invalid");
  }

  const reactivation = byKey.get(
    "registration_reactivation",
  ) as RegistrationReactivationRequirement;
  if (
    reactivation.condition.operation !== "registration_reactivate" ||
    reactivation.policy.historicalRows !== "all" ||
    reactivation.policy.candidateStatus !== "cancelled" ||
    reactivation.policy.selection !== "newest_by_id" ||
    reactivation.policy.updateMode !== "in_place" ||
    !hasExactValues(reactivation.policy.blockedStatuses, [
      "confirmed",
      "waitlisted",
      "pending_approval",
    ]) ||
    !hasExactValues(reactivation.policy.clearFields, [
      "cancelledAt",
      "cancelledBy",
      "approvedAt",
      "approvedBy",
    ])
  ) {
    throw new Error(
      "Rotating-partner registration-reactivation requirement is invalid",
    );
  }

  const cancellation = byKey.get("cancellation") as CancellationRequirement;
  if (
    cancellation.condition.operation !== "registration_cancel" ||
    cancellation.condition.publicRequest !== true ||
    cancellation.policy.lookup !== "player_snapshot_email" ||
    cancellation.policy.alreadyCancelledAction !== "reject" ||
    cancellation.policy.cancelledStatus !== "cancelled" ||
    cancellation.policy.cancelledBy !== "participant" ||
    cancellation.policy.consumeVerificationCode !== true
  ) {
    throw new Error("Rotating-partner cancellation requirement is invalid");
  }

  const transitions = byKey.get(
    "status_transitions",
  ) as StatusTransitionsRequirement;
  if (
    !hasExactOperations(transitions.condition.operations, [
      "registration_create",
      "registration_reactivate",
      "approval",
      "waitlist_promotion",
      "roster_edit",
    ]) ||
    !hasExactValues(transitions.policy.statuses, [
      "confirmed",
      "waitlisted",
      "pending_approval",
      "rejected",
      "cancelled",
      "no_show",
    ]) ||
    transitions.policy.approval.available !== "confirmed" ||
    transitions.policy.approval.full !== "waitlisted" ||
    transitions.policy.approval.setsApprovalMetadata !== true ||
    transitions.policy.rejection.target !== "rejected" ||
    transitions.policy.promotion.target !== "confirmed" ||
    transitions.policy.promotion.setsApprovalMetadata !== true ||
    transitions.policy.cancellation.target !== "cancelled" ||
    transitions.policy.cancellation.setsCancellationMetadata !== true ||
    transitions.policy.reactivationClearsCancellationMetadata !== true
  ) {
    throw new Error("Rotating-partner status-transitions requirement is invalid");
  }

  const snapshot = byKey.get(
    "registration_snapshot",
  ) as RegistrationSnapshotRequirement;
  if (
    !hasExactOperations(snapshot.condition.operations, [
      "registration_create",
      "registration_reactivate",
      "roster_edit",
    ]) ||
    snapshot.policy.source !== "member_at_write" ||
    snapshot.policy.sourceOfTruth !== "registration_snapshot" ||
    !hasExactValues(snapshot.policy.playerFields, [
      "name",
      "doubles",
      "singles",
      "selfRating",
      "email",
      "phone",
    ]) ||
    !hasExactValues(snapshot.policy.partnerFields, [
      "partnerName",
      "partnerDoubles",
      "partnerSelfRating",
    ]) ||
    snapshot.policy.assignedRating !== "numeric_member_doubles_or_null"
  ) {
    throw new Error("Rotating-partner registration-snapshot requirement is invalid");
  }

  const ratingValidation = byKey.get(
    "rating_validation",
  ) as RatingValidationRequirement;
  if (
    !hasExactValues(ratingValidation.condition.ratingTypes, [
      "dupr",
      "self_numeric",
      "self_skill",
    ]) ||
    ratingValidation.condition.operation !== "registration_create" ||
    ratingValidation.policy.eventConfigSource !== "event.ratingConfig" ||
    ratingValidation.policy.numericPrecision !== 2 ||
    ratingValidation.policy.numericRange !== "event_configured" ||
    ratingValidation.policy.skillValue !== "integer_level" ||
    ratingValidation.policy.nrRange.min !== 2 ||
    ratingValidation.policy.nrRange.max !== 5 ||
    ratingValidation.policy.nrPrecision !== 2 ||
    ratingValidation.policy.missingRequiredConfig !== "reject" ||
    ratingValidation.policy.staffBypassRequiresExplicitFlag !== true
  ) {
    throw new Error("Rotating-partner rating-validation requirement is invalid");
  }

  const precedence = byKey.get(
    "event_settings_precedence",
  ) as EventSettingsPrecedenceRequirement;
  if (
    !hasExactOperations(precedence.condition.operations, [
      "event_create",
      "event_clone",
      "event_update",
      "frontend_event_create",
    ]) ||
    precedence.policy.eventSpecificSource !== "database_event" ||
    precedence.policy.globalDefaultsSource !== "database_event_defaults" ||
    precedence.policy.jsonDefaultsRole !== "initial_fallback" ||
    precedence.policy.cloneSource !== "source_event" ||
    precedence.policy.serverAuthority !== "database_event"
  ) {
    throw new Error(
      "Rotating-partner event-settings-precedence requirement is invalid",
    );
  }

  const rosterSummary = byKey.get(
    "roster_summary",
  ) as RosterSummaryRequirement;
  if (
    rosterSummary.condition.operation !== "roster_summary" ||
    !hasExactValues(rosterSummary.policy.countedStatuses, [
      "confirmed",
      "waitlisted",
      "pending_approval",
    ]) ||
    !hasExactValues(rosterSummary.policy.excludedStatuses, [
      "rejected",
      "cancelled",
      "no_show",
    ]) ||
    rosterSummary.policy.total !== "sum_counted_statuses" ||
    rosterSummary.policy.capacitySource !== "event.maxParticipants" ||
    rosterSummary.policy.teamFields !== "null_for_rotating"
  ) {
    throw new Error("Rotating-partner roster-summary requirement is invalid");
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