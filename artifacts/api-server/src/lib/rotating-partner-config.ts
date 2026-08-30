import rawConfig from "../../../../app-config/rotating-partner-config.json";
import {
  getRotatingPartnerRequirement as getSharedRotatingPartnerRequirement,
  loadRotatingPartnerConfig,
} from "@workspace/rotating-partner-config";
import type {
  ActiveRegistrationRequirement,
  CapacityDefaultsRequirement,
  CapacityEnforcementRequirement,
  CapacityWriteSerializationRequirement,
  ParticipantCapacityRequirement,
  ParticipantRegistrationRequirement,
  RatingEnforcementRequirement,
  RotatingPartnerCapacityOperation,
  RotatingPartnerCapacityBehavior,
  RotatingPartnerConfig,
  RotatingPartnerRequirement,
  RotatingPartnerRequirementByKey,
  RotatingPartnerRequirementCondition,
  RotatingPartnerRequirementKey,
  SelfRatingInputRequirement,
} from "@workspace/rotating-partner-config";

export { loadRotatingPartnerConfig } from "@workspace/rotating-partner-config";
export type {
  ActiveRegistrationRequirement,
  CapacityDefaultsRequirement,
  CapacityEnforcementRequirement,
  CapacityWriteSerializationRequirement,
  ParticipantCapacityRequirement,
  ParticipantRegistrationRequirement,
  RatingEnforcementRequirement,
  RotatingPartnerCapacityBehavior,
  RotatingPartnerCapacityOperation,
  RotatingPartnerConfig,
  RotatingPartnerRequirement,
  RotatingPartnerRequirementByKey,
  RotatingPartnerRequirementCondition,
  RotatingPartnerRequirementKey,
  SelfRatingInputRequirement,
} from "@workspace/rotating-partner-config";

export const rotatingPartnerConfig = loadRotatingPartnerConfig(rawConfig);

export function getRotatingPartnerRequirement<
  Key extends RotatingPartnerRequirementKey,
>(key: Key): RotatingPartnerRequirementByKey[Key];
export function getRotatingPartnerRequirement(
  key: string,
): RotatingPartnerRequirement;
export function getRotatingPartnerRequirement(
  key: string,
): RotatingPartnerRequirement {
  return getSharedRotatingPartnerRequirement(rotatingPartnerConfig, key);
}