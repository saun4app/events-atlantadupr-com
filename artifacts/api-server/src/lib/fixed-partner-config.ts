import rawConfig from "../../../../app-config/fixed-partner-config.json";

export interface FixedPartnerRequirement {
  id: string;
  key: string;
  condition: {
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
  };
  required?: boolean;
  acceptedIdentifiers?: string[];
  checks?: string[];
  staffBypass?: boolean;
  scope?: string;
  membershipRoles?: string[];
  activeStatuses?: string[];
  excludeCurrentRegistrationOnEdit?: boolean;
  lockStrategy?: string;
  lockScope?: string;
  lockNamespace?: string;
  [key: string]: unknown;
}

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

  const requirementsByKey = new Map(
    config.requirements.map((requirement) => [requirement.key, requirement]),
  );
  const rosterEdit = requirementsByKey.get("roster_edit_validation");
  if (
    rosterEdit?.condition.operation !== "roster_edit" ||
    !Array.isArray(rosterEdit.condition.ratingTypes) ||
    !rosterEdit.condition.ratingTypes.includes("dupr") ||
    !rosterEdit.condition.ratingTypes.includes("self_numeric") ||
    rosterEdit.condition.approvalMode !== "enforce_rating" ||
    rosterEdit.condition.resolvedPartner !== true ||
    rosterEdit.staffBypass !== true
  ) {
    throw new Error("Fixed-partner roster-edit validation requirement is invalid");
  }
  const rosterEditChecks = rosterEdit.checks;
  if (
    !Array.isArray(rosterEditChecks) ||
    !["nr", "rating_range", "partner_rating_gap"].every((check) =>
      rosterEditChecks.includes(check),
    )
  ) {
    throw new Error("Fixed-partner roster-edit validation checks are invalid");
  }

  const membership = requirementsByKey.get("active_team_membership");
  if (
    !Array.isArray(membership?.condition.operations) ||
    !membership.condition.operations.includes("registration") ||
    !membership.condition.operations.includes("roster_edit") ||
    membership.scope !== "event" ||
    !Array.isArray(membership.membershipRoles) ||
    !membership.membershipRoles.includes("primary") ||
    !membership.membershipRoles.includes("partner") ||
    !Array.isArray(membership.activeStatuses) ||
    !membership.activeStatuses.includes("confirmed") ||
    !membership.activeStatuses.includes("waitlisted") ||
    !membership.activeStatuses.includes("pending_approval") ||
    membership.excludeCurrentRegistrationOnEdit !== true
  ) {
    throw new Error("Fixed-partner active team membership requirement is invalid");
  }

  const serialization = requirementsByKey.get("membership_write_serialization");
  if (
    !Array.isArray(serialization?.condition.operations) ||
    !serialization.condition.operations.includes("registration_create") ||
    !serialization.condition.operations.includes("registration_reactivate") ||
    !serialization.condition.operations.includes("roster_edit") ||
    serialization.lockStrategy !== "postgres_advisory_xact" ||
    serialization.lockScope !== "event" ||
    typeof serialization.lockNamespace !== "string" ||
    serialization.lockNamespace.length === 0
  ) {
    throw new Error("Fixed-partner membership-write serialization requirement is invalid");
  }

  return config as FixedPartnerConfig;
}

export const fixedPartnerConfig = loadFixedPartnerConfig(rawConfig);

export function getFixedPartnerRequirement(key: string): FixedPartnerRequirement {
  const requirement = fixedPartnerConfig.requirements.find((entry) => entry.key === key);
  if (!requirement) {
    throw new Error(`Missing fixed-partner requirement: ${key}`);
  }
  return requirement;
}