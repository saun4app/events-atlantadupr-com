import assert from "node:assert/strict";
import test from "node:test";
import { checkUserRoles } from "./check-user-roles.mjs";

const roleIds = [
  "app_admin",
  "event_organizer",
  "event_participant",
  "event_captain",
  "court_leader",
];

test("user-role configuration matches the OpenAPI and generated contracts", async () => {
  const result = await checkUserRoles();
  assert.deepEqual(result.roleIds, roleIds);
});

test("rejects a contract with a reordered or missing user role", async () => {
  await assert.rejects(
    checkUserRoles({
      config: { roles: roleIds.slice(0, -1).map((id) => ({ id })) },
      openApiText: "enum: [app_admin, event_organizer, event_participant, event_captain]",
      generatedTexts: ["", "", "", ""],
    }),
    /out of sync|Could not find generated/,
  );
});