import { z } from "zod";
import {
  Calendar,
  Plus,
  Settings,
  Shield,
  Users,
  type LucideIcon,
} from "lucide-react";
import rawSiteNav from "../../../../api-docs/site-nav.json";
import {
  USER_ROLE_GROUP_NAMES,
  loadUserRolesConfig,
  userRoleIsInGroup,
  type UserRoleGroupName,
} from "@workspace/user-roles-config";
import rawUserRolesConfig from "../../../../app-config/user-roles.json";
export type EventType = "rotating" | "fixed_partner";
export type MatchType = "prefix" | "exact";

export interface NavigationItemConfig {
  id: string;
  testId: string;
  label: string;
  href?: string;
  hrefTemplate?: string;
  match: {
    type: MatchType;
    value?: string;
    valueTemplate?: string;
  };
  icon: string;
  roleGroup: UserRoleGroupName;
  children?: NavigationItemConfig[];
}

export interface NavigationItem
  extends Omit<NavigationItemConfig, "icon" | "children" | "href" | "hrefTemplate" | "match"> {
  href: string;
  match: {
    type: MatchType;
    value: string;
  };
  icon: LucideIcon;
  children?: NavigationItem[];
}

const navigationRoleGroupSchema = z.enum(USER_ROLE_GROUP_NAMES);
const iconRegistry: Record<string, LucideIcon> = {
  calendar: Calendar,
  plus: Plus,
  settings: Settings,
  shield: Shield,
  users: Users,
};

const matchSchema = z
  .object({
    type: z.enum(["prefix", "exact"]),
    value: z.string().min(1).optional(),
    valueTemplate: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((match, context) => {
    if ((match.value === undefined) === (match.valueTemplate === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exactly one of value or valueTemplate is required",
      });
    }
  });

const navigationItemSchema: z.ZodType<NavigationItemConfig> = z.lazy(() =>
  z
    .object({
      id: z.string().regex(/^[a-f0-9]{8}$/, "must be an 8-character lowercase hexadecimal ID"),
      testId: z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/),
      label: z.string().min(1),
      href: z.string().startsWith("/").optional(),
      hrefTemplate: z.string().startsWith("/").optional(),
      match: matchSchema,
      icon: z.string().min(1),
      roleGroup: navigationRoleGroupSchema,
      children: z.array(navigationItemSchema).optional(),
    })
    .strict()
    .superRefine((item, context) => {
      if ((item.href === undefined) === (item.hrefTemplate === undefined)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "exactly one of href or hrefTemplate is required",
          path: ["href"],
        });
      }

      for (const template of [
        item.hrefTemplate,
        item.match.valueTemplate,
      ].filter((value): value is string => value !== undefined)) {
        const withoutEventType = template.replaceAll("{eventType}", "");
        if (!/^[a-zA-Z0-9:/_.-]+$/.test(withoutEventType)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "route templates contain unsupported characters",
          });
        }
        if (template.includes("{") && !template.includes("{eventType}")) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "route templates may only use the eventType placeholder",
          });
        }
      }
    }),
);

const siteNavSchema = z
  .object({
    version: z.literal(1),
    items: z.array(navigationItemSchema).min(1),
  })
  .strict()
  .superRefine((document, context) => {
    const ids = new Set<string>();
    const visit = (item: NavigationItemConfig, path: string) => {
      if (ids.has(item.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate navigation item ID "${item.id}"`,
          path: ["items", path],
        });
      }
      ids.add(item.id);
      item.children?.forEach((child, index) => visit(child, `${path}.children.${index}`));
    };

    document.items.forEach((item, index) => visit(item, `${index}`));
  });

const parsedSiteNav = siteNavSchema.safeParse(rawSiteNav);

if (!parsedSiteNav.success) {
  const details = parsedSiteNav.error.issues
    .map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid api-docs/site-nav.json: ${details}`);
}

const siteNav = parsedSiteNav.data;
const userRolesConfig = loadUserRolesConfig(rawUserRolesConfig);

function validateIcons(items: NavigationItemConfig[]): void {
  for (const item of items) {
    if (!iconRegistry[item.icon]) {
      throw new Error(`Invalid api-docs/site-nav.json: unsupported icon "${item.icon}"`);
    }
    if (item.children) {
      validateIcons(item.children);
    }
  }
}

validateIcons(siteNav.items);

function resolveTemplate(template: string, eventType?: EventType): string {
  if (!template.includes("{eventType}")) {
    return template;
  }
  if (!eventType) {
    throw new Error(`Navigation route "${template}" requires an event type`);
  }
  return template.replaceAll("{eventType}", eventType);
}

function resolveItem(item: NavigationItemConfig, eventType?: EventType): NavigationItem {
  const icon = iconRegistry[item.icon];

  const href = item.href ?? resolveTemplate(item.hrefTemplate!, eventType);
  const matchValue = item.match.value ?? resolveTemplate(item.match.valueTemplate!, eventType);

  return {
    ...item,
    href,
    match: {
      type: item.match.type,
      value: matchValue,
    },
    icon,
    children: eventType
      ? item.children?.map((child) => resolveItem(child, eventType))
      : undefined,
  };
}

function hasRole(item: NavigationItemConfig, role?: string): boolean {
  return userRoleIsInGroup(userRolesConfig, role, item.roleGroup);
}

export function getAdminNavigationItems(role?: string): NavigationItem[] {
  return siteNav.items
    .filter((item) => hasRole(item, role))
    .map((item) => resolveItem(item));
}

export function getEventsNavigationItems(eventType: EventType): NavigationItem[] {
  const eventsItem = siteNav.items.find((item) => item.children?.length);
  if (!eventsItem?.children) {
    throw new Error("Invalid api-docs/site-nav.json: no nested events navigation found");
  }
  return eventsItem.children.map((item) => resolveItem(item, eventType));
}

export function isNavigationItemActive(item: NavigationItem, location: string): boolean {
  return item.match.type === "exact"
    ? location === item.match.value
    : location.startsWith(item.match.value);
}

export function navigationTestId(item: NavigationItem, mobile = false): string {
  const prefix = mobile ? "nav-mobile-" : "nav-";
  return `${prefix}${item.testId}`;
}

export function getSiteNavigationForTesting(): NavigationItemConfig[] {
  return siteNav.items;
}