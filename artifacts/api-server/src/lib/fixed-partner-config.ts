import rawConfig from "../../../../app-config/fixed-partner-config.json";

export interface FixedPartnerRequirement {
  id: string;
  key: string;
  condition: {
    eventFormat: "fixed_partner";
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