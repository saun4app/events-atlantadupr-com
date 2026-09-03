import rawUserRolesConfig from "../../../../app-config/user-roles.json";
import {
  getUserRole,
  getUserRoleIds,
  getEventRoleIds,
  getVirtualUserRoleIds,
  loadUserRolesConfig,
  userRoleIsInGroup,
  type UserRoleGroupName,
  type UserRolesConfig,
} from "@workspace/user-roles-config";

export const userRolesConfig: UserRolesConfig = loadUserRolesConfig(rawUserRolesConfig);
export const USER_ROLE_GROUPS = userRolesConfig.groups;
export const USER_ROLE_IDS = Object.fromEntries(
  getUserRoleIds(userRolesConfig).map((role) => [role, role]),
) as Record<string, string>;
export const EVENT_ROLE_IDS = Object.fromEntries(
  getEventRoleIds(userRolesConfig).map((role) => [role, role]),
) as Record<string, string>;
export const VIRTUAL_USER_ROLE_IDS = Object.fromEntries(
  getVirtualUserRoleIds(userRolesConfig).map((roleId) => [roleId, roleId]),
) as Record<string, string>;

export const defaultNewUserRole = userRolesConfig.defaults.newUserRole;

export function hasUserRole(
  roleId: string | null | undefined,
  groupName: UserRoleGroupName,
): boolean {
  return userRoleIsInGroup(userRolesConfig, roleId, groupName);
}

export function getUserRoleLabel(roleId: string): string {
  return getUserRole(userRolesConfig, roleId)?.label ?? roleId;
}

export function getUserRoleBadgeTone(roleId: string): string {
  return getUserRole(userRolesConfig, roleId)?.badgeTone ?? "muted";
}