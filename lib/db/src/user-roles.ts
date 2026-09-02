import rawUserRolesConfig from "../../../app-config/user-roles.json";
import {
  getUserRoleIds,
  loadUserRolesConfig,
} from "@workspace/user-roles-config";

export const userRolesConfig = loadUserRolesConfig(rawUserRolesConfig);
export const userRoleIds = getUserRoleIds(userRolesConfig);
export const userRoleIdMap = Object.fromEntries(
  userRoleIds.map((roleId) => [roleId, roleId]),
) as Record<string, string>;
export const defaultUserRole = userRolesConfig.defaults.databaseRole;