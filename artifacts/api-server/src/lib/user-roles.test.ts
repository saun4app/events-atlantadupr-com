import assert from "node:assert/strict";
import test from "node:test";

import rawUserRolesConfig from "../../../../app-config/user-roles.json";
import {
  loadUserRolesConfig,
  userRoleIsInGroup,
} from "@workspace/user-roles-config";

test("loads the configured user roles and preserves access groups", () => {
  const config = loadUserRolesConfig(rawUserRolesConfig);

  assert.deepEqual(
    config.roles.map((role) => role.id),
    ["admin", "event_organizer", "event_participant", "event_captain", "court_leader"],
  );
  assert.equal(config.defaults.databaseRole, "event_participant");
  assert.equal(config.defaults.newUserRole, "event_organizer");
  assert.equal(userRoleIsInGroup(config, "admin", "adminOnly"), true);
  assert.equal(userRoleIsInGroup(config, "event_participant", "adminPanel"), false);
  assert.equal(userRoleIsInGroup(config, "event_captain", "assignableStaff"), true);
});

test("rejects duplicate roles, unknown group members, and unknown defaults", () => {
  const config = structuredClone(rawUserRolesConfig);
  config.roles.push({ id: "admin", label: "Duplicate", badgeTone: "primary" });
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