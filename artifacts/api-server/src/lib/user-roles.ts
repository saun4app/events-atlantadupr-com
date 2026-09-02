import rawUserRolesConfig from "../../../../app-config/user-roles.json";
import {
  getUserRole,
  getUserRoleIds,
  loadUserRolesConfig,
  canonicalizeUserRole as canonicalizeConfiguredUserRole,
  userRoleIsInGroup,
  type UserRoleGroupName,
  type UserRolesConfig,
} from "@workspace/user-roles-config";

export const userRolesConfig: UserRolesConfig = loadUserRolesConfig(rawUserRolesConfig);
export const USER_ROLE_IDS = Object.fromEntries(
  getUserRoleIds(userRolesConfig).map((roleId) => [roleId, roleId]),
) as Record<string, string>;
export const USER_ROLE_GROUPS = userRolesConfig.groups;

export const defaultDatabaseRole = userRolesConfig.defaults.databaseRole;
export const auditActorRole = userRolesConfig.defaults.auditActorRole;
export const canonicalizeUserRole = canonicalizeConfiguredUserRole;

export function hasUserRole(
  roleId: string | null | undefined,
  groupName: UserRoleGroupName,
): boolean {
  return userRoleIsInGroup(userRolesConfig, roleId, groupName);
}

export function isConfiguredUserRole(roleId: string): boolean {
  return getUserRole(userRolesConfig, roleId) !== undefined;
}