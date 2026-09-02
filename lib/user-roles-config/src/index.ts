import { z } from "zod";

export const USER_ROLE_BADGE_TONES = [
  "primary",
  "blue",
  "purple",
  "yellow",
  "muted",
] as const;

export const USER_ROLE_GROUP_NAMES = [
  "adminOnly",
  "adminPanel",
  "eventManagers",
  "eventWriters",
  "assignableStaff",
] as const;

export const LEGACY_USER_ROLE_ALIASES = {
  admin: "app_admin",
  event_participant: "club_member",
} as const;

const roleSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1),
    badgeTone: z.enum(USER_ROLE_BADGE_TONES),
  })
  .strict();

const userRolesConfigSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    roles: z.array(roleSchema).min(1),
    virtualRoles: z.array(roleSchema).min(1),
    defaults: z
      .object({
        databaseRole: z.string().min(1),
        newUserRole: z.string().min(1),
        auditActorRole: z.string().min(1),
      })
      .strict(),
    groups: z
      .object({
        adminOnly: z.array(z.string().min(1)).min(1),
        adminPanel: z.array(z.string().min(1)).min(1),
        eventManagers: z.array(z.string().min(1)).min(1),
        eventWriters: z.array(z.string().min(1)).min(1),
        assignableStaff: z.array(z.string().min(1)).min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((config, context) => {
    const roleIds = config.roles.map((role) => role.id);
    const virtualRoleIds = config.virtualRoles.map((role) => role.id);
    const allRoleIds = [...roleIds, ...virtualRoleIds];
    const uniqueRoleIds = new Set(allRoleIds);
    if (uniqueRoleIds.size !== allRoleIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "roles must not contain duplicate IDs",
        path: ["roles"],
      });
    }

    const roleIdSet = new Set(roleIds);
    for (const groupName of USER_ROLE_GROUP_NAMES) {
      for (const roleId of config.groups[groupName]) {
        if (!roleIdSet.has(roleId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown role "${roleId}"`,
            path: ["groups", groupName],
          });
        }
      }
    }

    for (const [key, roleId] of Object.entries(config.defaults)) {
      if (!roleIdSet.has(roleId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown role "${roleId}"`,
          path: ["defaults", key],
        });
      }
    }

    for (const roleId of virtualRoleIds) {
      for (const groupName of USER_ROLE_GROUP_NAMES) {
        if (config.groups[groupName].includes(roleId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `virtual role "${roleId}" cannot be assigned to ${groupName}`,
            path: ["groups", groupName],
          });
        }
      }
    }
  });

export type UserRoleBadgeTone = (typeof USER_ROLE_BADGE_TONES)[number];
export type UserRoleGroupName = (typeof USER_ROLE_GROUP_NAMES)[number];
export type UserRoleDefinition = z.infer<typeof roleSchema>;
export type UserRolesConfig = z.infer<typeof userRolesConfigSchema>;

export function loadUserRolesConfig(document: unknown): UserRolesConfig {
  return userRolesConfigSchema.parse(document);
}

export function getUserRoleIds(config: UserRolesConfig): [string, ...string[]] {
  if (config.roles.length === 0) {
    throw new Error("User roles configuration must define at least one role");
  }
  return config.roles.map((role) => role.id) as [string, ...string[]];
}

export function getUserRole(config: UserRolesConfig, roleId: string): UserRoleDefinition | undefined {
  return [...config.roles, ...config.virtualRoles].find((role) => role.id === roleId);
}

export function getVirtualUserRoleIds(config: UserRolesConfig): [string, ...string[]] {
  if (config.virtualRoles.length === 0) {
    throw new Error("User roles configuration must define at least one virtual role");
  }
  return config.virtualRoles.map((role) => role.id) as [string, ...string[]];
}

export function canonicalizeUserRole(roleId: string): string {
  return LEGACY_USER_ROLE_ALIASES[roleId as keyof typeof LEGACY_USER_ROLE_ALIASES] ?? roleId;
}

export function userRoleIsInGroup(
  config: UserRolesConfig,
  roleId: string | null | undefined,
  groupName: UserRoleGroupName,
): boolean {
  return roleId !== null && roleId !== undefined && config.groups[groupName].includes(roleId);
}