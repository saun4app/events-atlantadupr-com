import assert from "node:assert/strict";
import test from "node:test";

import rawUserRolesConfig from "../../../../app-config/user-roles.json";
import {
  canonicalizeUserRole,
  loadUserRolesConfig,
  getUserRoleIds,
  getVirtualUserRoleIds,
  userRoleIsInGroup,
} from "@workspace/user-roles-config";
import {
  getRequestUserRole,
  isConfiguredUserRole,
  siteVisitorRole,
  USER_ROLE_IDS,
  VIRTUAL_USER_ROLE_IDS,
} from "./user-roles.js";

test("loads the configured user roles and preserves access groups", () => {
  const config = loadUserRolesConfig(rawUserRolesConfig);

  assert.deepEqual(
    config.roles.map((role) => role.id),
    ["app_admin", "event_organizer", "club_member", "event_captain", "club_director", "court_leader"],
  );
  assert.deepEqual(config.virtualRoles.map((role) => role.id), ["site_visitor"]);
  assert.deepEqual(getUserRoleIds(config), config.roles.map((role) => role.id));
  assert.deepEqual(getVirtualUserRoleIds(config), ["site_visitor"]);
  assert.equal(config.defaults.databaseRole, "club_member");
  assert.equal(config.defaults.newUserRole, "event_organizer");
   assert.equal(userRoleIsInGroup(config, "app_admin", "adminOnly"), true);
  assert.equal(userRoleIsInGroup(config, "club_member", "adminPanel"), false);
  assert.equal(userRoleIsInGroup(config, "event_captain", "assignableStaff"), true);
  for (const groupName of ["adminPanel", "eventWriters", "assignableStaff"] as const) {
    assert.equal(
      userRoleIsInGroup(config, "club_director", groupName),
      userRoleIsInGroup(config, "event_captain", groupName),
    );
  }
  assert.equal(userRoleIsInGroup(config, "club_director", "eventManagers"), false);
  assert.equal(userRoleIsInGroup(config, "site_visitor", "adminPanel"), false);
});

test("uses site_visitor for anonymous requests without making it a persisted role", () => {
  assert.equal(siteVisitorRole, "site_visitor");
  assert.equal(USER_ROLE_IDS.site_visitor, undefined);
  assert.equal(VIRTUAL_USER_ROLE_IDS.site_visitor, "site_visitor");
  assert.equal(isConfiguredUserRole("club_director"), true);
  assert.equal(isConfiguredUserRole("site_visitor"), false);
  assert.equal(getRequestUserRole({}), "site_visitor");
  assert.equal(getRequestUserRole({ session: { role: "event_captain" } }), "event_captain");
  assert.equal(getRequestUserRole({ session: { role: "admin" } }), "app_admin");
});

test("canonicalizes legacy admin values without changing other roles", () => {
  assert.equal(canonicalizeUserRole("admin"), "app_admin");
  assert.equal(canonicalizeUserRole("event_participant"), "club_member");
  assert.equal(canonicalizeUserRole("event_organizer"), "event_organizer");
});

test("rejects duplicate roles, unknown group members, and unknown defaults", () => {
  const config = structuredClone(rawUserRolesConfig);
   config.roles.push({ id: "app_admin", label: "Duplicate", badgeTone: "primary" });
  config.groups.adminOnly = ["missing_role"];
  config.defaults.databaseRole = "missing_role";

  assert.throws(() => loadUserRolesConfig(config), /duplicate|unknown role/i);
});

test("rejects a document missing a required group", () => {
  const missingGroup = structuredClone(rawUserRolesConfig) as {
    groups: Record<string, unknown>;
  };
  delete missingGroup.groups.assignableStaff;
  assert.throws(() => loadUserRolesConfig(missingGroup), /assignableStaff/i);
});