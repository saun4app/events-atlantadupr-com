import assert from "node:assert/strict";
import test from "node:test";
import { checkUserRoles } from "./check-user-roles.mjs";

const roleIds = [
  "app_admin",
  "club_director",
  "club_member",
];
const eventRoleIds = [
  "event_organizer",
  "event_captain",
  "court_leader",
];

test("user-role configuration matches the OpenAPI and generated contracts", async () => {
  const result = await checkUserRoles();
  assert.deepEqual(result.roleIds, roleIds);
  assert.deepEqual(result.eventRoleIds, eventRoleIds);
});

test("rejects a contract with a reordered or missing user role", async () => {
  await assert.rejects(
    checkUserRoles({
      config: {
        accountRoles: roleIds.slice(0, -1).map((id) => ({ id })),
        eventRoles: eventRoleIds.map((id) => ({ id })),
      },
      openApiText: "enum: [app_admin, club_director]",
      generatedTexts: ["", "", "", "", ""],
    }),
    /out of sync|Could not find generated/,
  );
});

test("rejects an outdated browser mock role with its file and line", async () => {
  const browserMockTexts = [{
    path: "e2e/admin-navigation.spec.ts",
    text: 'const user = {\n  role: "removed_admin",\n};',
  }];

  await assert.rejects(
    checkUserRoles({ browserMockTexts }),
    /e2e\/admin-navigation\.spec\.ts:2 uses unknown account role "removed_admin"/,
  );
});

test("allows current event roles and explicitly marked legacy account roles", async () => {
  const browserMockTexts = [{
    path: "e2e/admin-user-roles.spec.ts",
    text: [
      'const assignment = { role: "event_captain" };',
      '// legacy-account-role: event_participant — verifies historical account-role fallback',
      'const legacyUser = { role: "event_participant" };',
    ].join("\n"),
  }];

  await checkUserRoles({ browserMockTexts });
});

test("does not accept a legacy marker for a different role", async () => {
  const browserMockTexts = [{
    path: "e2e/admin-user-roles.spec.ts",
    text: [
      "// legacy-account-role: event_participant — verifies historical account-role fallback",
      'const user = { role: "removed_admin" };',
    ].join("\n"),
  }];

  await assert.rejects(
    checkUserRoles({ browserMockTexts }),
    /e2e\/admin-user-roles\.spec\.ts:2 uses unknown account role "removed_admin"/,
  );
});
