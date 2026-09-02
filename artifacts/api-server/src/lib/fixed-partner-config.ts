import rawConfig from "../../../../app-config/fixed-partner-config.json";
import {
  getFixedPartnerRequirement as getSharedFixedPartnerRequirement,
  loadFixedPartnerConfig,
} from "@workspace/fixed-partner-config";
import type {
  FixedPartnerConfig,
  FixedPartnerRequirement,
  FixedPartnerRequirementByKey,
  FixedPartnerRequirementKey,
  FixedPartnerRequirementCondition,
  ActiveTeamMembershipRequirement,
  AdminAddInputRequirement,
  CapacityWriteSerializationRequirement,
  CapacityDefaultsRequirement,
  EventLimitSafetyRequirement,
  FixedPartnerCapacityDecisionOperation,
  FixedPartnerCapacityWriteOperation,
  FixedPartnerFullCapacityAction,
  FixedPartnerFullCapacityBehavior,
  MembershipWriteSerializationRequirement,
  NrPartnerCheckRequirement,
  PartnerRatingGapRequirement,
  PartnerRatingRangeRequirement,
  PartnerRegistrationRequirement,
  PublicPartnerPreflightRequirement,
  RosterEditValidationRequirement,
  TeamCapacityRequirement,
  TeamCapacityEnforcementRequirement,
} from "@workspace/fixed-partner-config";

export {
  loadFixedPartnerConfig,
} from "@workspace/fixed-partner-config";
export type {
  ActiveTeamMembershipRequirement,
  AdminAddInputRequirement,
  CapacityWriteSerializationRequirement,
  CapacityDefaultsRequirement,
  EventLimitSafetyRequirement,
  FixedPartnerCapacityDecisionOperation,
  FixedPartnerCapacityWriteOperation,
  FixedPartnerConfig,
  FixedPartnerFullCapacityAction,
  FixedPartnerFullCapacityBehavior,
  FixedPartnerRequirement,
  FixedPartnerRequirementByKey,
  FixedPartnerRequirementCondition,
  FixedPartnerRequirementKey,
  MembershipWriteSerializationRequirement,
  NrPartnerCheckRequirement,
  PartnerRatingGapRequirement,
  PartnerRatingRangeRequirement,
  PartnerRegistrationRequirement,
  PublicPartnerPreflightRequirement,
  RosterEditValidationRequirement,
  TeamCapacityRequirement,
  TeamCapacityEnforcementRequirement,
} from "@workspace/fixed-partner-config";

export const fixedPartnerConfig = loadFixedPartnerConfig(rawConfig);

export function getFixedPartnerRequirement<Key extends FixedPartnerRequirementKey>(
  key: Key,
): FixedPartnerRequirementByKey[Key];
export function getFixedPartnerRequirement(key: string): FixedPartnerRequirement;
export function getFixedPartnerRequirement(
  key: string,
): FixedPartnerRequirement {
  return getSharedFixedPartnerRequirement(fixedPartnerConfig, key);
}