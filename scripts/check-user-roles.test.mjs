import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
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
    path: "e2e/admin-user-roles.spec.ts",
    text: 'const user = {\n  role: "removed_admin",\n};',
  }];

  await assert.rejects(
    checkUserRoles({ browserMockTexts }),
    /e2e\/admin-user-roles\.spec\.ts:2 uses unknown account role "removed_admin"/,
  );
});

test("discovers nested browser mocks and reports their relative path and line", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join("e2e", "fixtures", ".check-user-roles-"),
  );
  const mockPath = path.join(
    temporaryDirectory,
    "nested",
    "deep",
    "stale-role.spec.ts",
  );

  try {
    await mkdir(path.dirname(mockPath), { recursive: true });
    await writeFile(mockPath, 'const user = {\n  role: "removed_nested_role",\n};');

    await assert.rejects(
      checkUserRoles(),
      (error) => {
        assert.equal(
          error.message,
          `${mockPath}:2 uses unknown account role "removed_nested_role"`,
        );
        return true;
      },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
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

test("rejects outdated event-role literals in browser API mocks with file and line", async () => {
  for (const field of ["eventRole", "userRole", "role"]) {
    await assert.rejects(
      checkUserRoles({
        browserMockTexts: [{
          path: "e2e/admin-navigation.spec.ts",
          text: `const mock = {\n  ${field}: "removed_event_role",\n};`,
        }],
      }),
      new RegExp(
        `e2e/admin-navigation\\.spec\\.ts:2 uses unknown event role "removed_event_role"`,
      ),
    );
  }
});
