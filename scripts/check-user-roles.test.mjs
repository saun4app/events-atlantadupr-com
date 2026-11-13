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

test("rejects an outdated browser fixture role with its file and line", async () => {
  const fixtureTexts = [
    'const user = {\n  role: "removed_admin",\n};',
    "",
    "",
    "",
  ];

  await assert.rejects(
    checkUserRoles({ fixtureTexts }),
    /e2e\/fixtures\/clone-event\.ts:2 uses unknown account role "removed_admin"/,
  );
});
