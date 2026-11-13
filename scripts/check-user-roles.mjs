import { readFile } from "node:fs/promises";

const configPath = "app-config/user-roles.json";
const openApiPath = "lib/api-spec/openapi.yaml";
const generatedPaths = [
  "lib/api-zod/src/generated/types/userRole.ts",
  "lib/api-zod/src/generated/types/userInputRole.ts",
  "lib/api-zod/src/generated/types/userUpdateRole.ts",
  "lib/api-zod/src/generated/types/eventAssignmentInputEventRole.ts",
  "lib/api-zod/src/generated/types/eventAssignmentEventRole.ts",
];
const fixturePaths = [
  "e2e/fixtures/clone-event.ts",
  "e2e/fixtures/fixed-partner.ts",
  "e2e/fixtures/rotating-partner.ts",
  "e2e/event-limit-validation.spec.ts",
];

function sameValues(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function parseObjectValues(text, constantName) {
  const match = text.match(new RegExp(`export const ${constantName} = \\{([\\s\\S]*?)\\} as const;`));
  if (!match) throw new Error(`Could not find generated ${constantName} role object`);
  return [...match[1].matchAll(/^\s*[A-Za-z0-9_]+:\s*'([^']+)'/gm)].map((entry) => entry[1]);
}

function parseOpenApiRoleEnums(text, expectedIds) {
  const expectedSet = new Set(expectedIds);
  return [...text.matchAll(/^\s*enum:\s*\[([^\]]+)\]/gm)]
    .map((match) => match[1].split(",").map((value) => value.trim()))
    .find((values) => values.length === expectedIds.length && values.every((value) => expectedSet.has(value)));
}

export async function checkUserRoles(options = {}) {
  const config = options.config ?? JSON.parse(await readFile(configPath, "utf8"));
  const openApiText = options.openApiText ?? await readFile(openApiPath, "utf8");
  const generatedTexts = options.generatedTexts ??
    await Promise.all(generatedPaths.map((path) => readFile(path, "utf8")));
  const fixtureTexts = options.fixtureTexts ??
    await Promise.all(fixturePaths.map((path) => readFile(path, "utf8")));
  const roleIds = config.accountRoles.map((role) => role.id);
  const eventRoleIds = config.eventRoles.map((role) => role.id);
  const roleSet = new Set(roleIds);
  if (roleSet.size !== roleIds.length) throw new Error("user-roles.json contains duplicate role IDs");

  const openApiRoleEnum = parseOpenApiRoleEnums(openApiText, roleIds);
  if (!openApiRoleEnum || !sameValues(openApiRoleEnum, roleIds)) {
    throw new Error("OpenAPI user-role enum is out of sync with app-config/user-roles.json");
  }

  const generatedConstantNames = ["UserRole", "UserInputRole", "UserUpdateRole", "EventAssignmentInputEventRole", "EventAssignmentEventRole"];
  generatedTexts.slice(0, 3).forEach((text, index) => {
    const values = parseObjectValues(text, generatedConstantNames[index]);
    if (!sameValues(values, roleIds)) {
      throw new Error(`${generatedPaths[index]} is out of sync with app-config/user-roles.json`);
    }
  });
  generatedTexts.slice(3).forEach((text, index) => {
    const values = parseObjectValues(text, generatedConstantNames[index + 3]);
    if (!sameValues(values, eventRoleIds)) {
      throw new Error(`${generatedPaths[index + 3]} is out of sync with app-config/user-roles.json eventRoles`);
    }
  });

  fixtureTexts.forEach((text, index) => {
    for (const match of text.matchAll(/\brole\s*:\s*["']([^"']+)["']/g)) {
      const role = match[1];
      if (roleSet.has(role)) continue;

      const line = text.slice(0, match.index).split("\n").length;
      throw new Error(
        `${fixturePaths[index]}:${line} uses unknown account role "${role}"`,
      );
    }
  });

  return { roleIds, eventRoleIds };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { roleIds } = await checkUserRoles();
    console.log(`User-role contract is synchronized (${roleIds.length} roles).`);
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}