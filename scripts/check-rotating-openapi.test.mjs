import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  validateDocumentationFilenames,
  validateDocumentationReferences,
  validateRotatingOpenApi,
  validateSharedApiContracts,
} from "./check-rotating-openapi.mjs";

const [
  openApiText,
  dataModel,
  config,
  platformOpenApiText,
  platformDataModel,
  platformConfig,
] = await Promise.all([
  readFile("api-docs/rotating-partner-event-api-module-openapi.yaml", "utf8"),
  readFile(
    "api-docs/rotating-partner-event-api-module-data-model.json",
    "utf8",
  ).then(JSON.parse),
  readFile(
    "api-docs/rotating-partner-event-api-module-config.json",
    "utf8",
  ).then(JSON.parse),
  readFile("api-docs/dupr-event-api-openapi.yaml", "utf8"),
  readFile("api-docs/dupr-event-api-data-model.json", "utf8").then(JSON.parse),
  readFile("api-docs/dupr-event-api-config.json", "utf8").then(JSON.parse),
]);

const staleSharedFilename = `dupr-event-api-data-${"modle"}.json`;
const staleSharedPath = `api-docs/${staleSharedFilename}`;
const staleModuleFilename = `rotating-partner-event-api-module-data-${"modle"}.json`;
const staleModulePath = `api-docs/${staleModuleFilename}`;
const incorrectModuleFilename = `rotating-partner-event-data-${"model"}.json`;

test("accepts the shared API server contracts", async () => {
  const result = await validateSharedApiContracts({
    openApiText: platformOpenApiText,
    dataModel: platformDataModel,
    config: platformConfig,
  });
  assert.equal(result.platformDocuments, 2);
});

test("accepts the canonical shared and module data-model filenames", () => {
  const result = validateDocumentationFilenames({
    files: [
      "api-docs/dupr-event-api-data-model.json",
      "api-docs/rotating-partner-event-api-module-data-model.json",
    ],
    fileContents: new Map([
      [
        "api-docs/dupr-event-api-proj-plan.md",
        "dupr-event-api-data-model.json",
      ],
      [
        "api-docs/rotating-partner-event-api-module-plan.md",
        "rotating-partner-event-api-module-data-model.json",
      ],
    ]),
  });
  assert.deepEqual(result.canonicalPaths, [
    "api-docs/dupr-event-api-data-model.json",
    "api-docs/rotating-partner-event-api-module-data-model.json",
  ]);
});

test("rejects a stale shared data-model reference and identifies its referrer", () => {
  assert.throws(
    () =>
      validateDocumentationFilenames({
        files: [
          "api-docs/dupr-event-api-data-model.json",
          "api-docs/rotating-partner-event-api-module-data-model.json",
        ],
        fileContents: new Map([
          ["api-docs/dupr-event-api-proj-plan.md", staleSharedFilename],
        ]),
      }),
    new RegExp(
      `${staleSharedPath.replaceAll(".", "\\.")}.*api-docs/dupr-event-api-proj-plan\\.md`,
    ),
  );
});

test("rejects a reintroduced old contract file as a duplicate", () => {
  assert.throws(
    () =>
      validateDocumentationFilenames({
        files: [
          "api-docs/dupr-event-api-data-model.json",
          staleSharedPath,
          "api-docs/rotating-partner-event-api-module-data-model.json",
        ],
        fileContents: new Map(),
      }),
    new RegExp(
      `${staleSharedPath.replaceAll(".", "\\.")}.*file "${staleSharedPath}"`,
    ),
  );
});

test("rejects an incorrect module data-model filename", () => {
  assert.throws(
    () =>
      validateDocumentationFilenames({
        files: [
          "api-docs/dupr-event-api-data-model.json",
          "api-docs/rotating-partner-event-api-module-data-model.json",
        ],
        fileContents: new Map([
          [
            "api-docs/rotating-partner-event-api-module-openapi.yaml",
            incorrectModuleFilename,
          ],
        ]),
      }),
    new RegExp(
      `${incorrectModuleFilename.replaceAll(".", "\\.")}.*rotating-partner-event-api-module-openapi\\.yaml`,
    ),
  );
});

test("rejects a stale rotating module data-model reference and identifies its referrer", () => {
  assert.throws(
    () =>
      validateDocumentationFilenames({
        files: [
          "api-docs/dupr-event-api-data-model.json",
          "api-docs/rotating-partner-event-api-module-data-model.json",
        ],
        fileContents: new Map([
          ["api-docs/rotating-partner-event-api-module-openapi.yaml", staleModuleFilename],
        ]),
      }),
    new RegExp(
      `${staleModulePath.replaceAll(".", "\\.")}.*rotating-partner-event-api-module-openapi\\.yaml`,
    ),
  );
});

test("rejects an external documentation target that is missing", () => {
  assert.throws(
    () =>
      validateDocumentationReferences({
        files: ["api-docs/module-openapi.yaml"],
        fileContents: new Map([
          [
            "api-docs/module-openapi.yaml",
            ["externalDocs:", "  url: ./missing-model.json"].join("\n"),
          ],
        ]),
      }),
    /api-docs\/missing-model\.json.*api-docs\/module-openapi\.yaml/,
  );
});

test("accepts relative documentation and OpenAPI references", () => {
  const result = validateDocumentationReferences({
    files: [
      "api-docs/module-openapi.yaml",
      "api-docs/shared-openapi.yaml",
      "api-docs/module-config.json",
    ],
    fileContents: new Map([
      [
        "api-docs/module-openapi.yaml",
        [
          "externalDocs:",
          "  url: ./module-config.json",
          "x-shared-openapi: ./shared-openapi.yaml#/components/schemas/Problem",
          '  $ref: "./shared-openapi.yaml#/components/responses/BadRequest"',
        ].join("\n"),
      ],
    ]),
  });
  assert.equal(result.referenceCount, 3);
});

test("rejects a missing Markdown link and identifies its referrer", () => {
  assert.throws(
    () =>
      validateDocumentationReferences({
        files: ["api-docs/plans/module-plan.md"],
        fileContents: new Map([
          [
            "api-docs/plans/module-plan.md",
            "[Data model](../missing-data-model.json#Document)",
          ],
        ]),
      }),
    /api-docs\/missing-data-model\.json.*api-docs\/plans\/module-plan\.md/,
  );
});

test("accepts relative Markdown links and excludes external and code-formatted examples", () => {
  const result = validateDocumentationReferences({
    files: [
      "api-docs/dupr-event-api-proj-plan.md",
      "api-docs/contracts/data-model.json",
    ],
    fileContents: new Map([
      [
        "api-docs/dupr-event-api-proj-plan.md",
        [
          "[Data model](contracts/data-model.json)",
          "[External](https://example.com/missing.json)",
          "`[Inline example](missing-inline.json)`",
          "```md",
          "[Fenced example](missing-fenced.json)",
          "```",
        ].join("\n"),
      ],
    ]),
  });
  assert.equal(result.referenceCount, 1);
});

test("accepts the standalone rotating OpenAPI contract", async () => {
  const result = await validateRotatingOpenApi({
    openApiText,
    dataModel,
    config,
    platformOpenApiText,
  });
  assert.ok(result.operations > 0);
  assert.ok(result.localReferences > 0);
});

test("rejects a full registration document on a public registration response", async () => {
  const unsafe = openApiText.replace(
    '#/components/schemas/PublicRegistrationDocument',
    '#/components/schemas/RegistrationDocument',
  );
  await assert.rejects(
    validateRotatingOpenApi({
      openApiText: unsafe,
      dataModel,
      config,
      platformOpenApiText,
    }),
    /redacted public registration document|exposes the full registration document/,
  );
});

test("rejects a public roster schema containing full registration documents", async () => {
  const marker = "    RegistrationListResponse:";
  const start = openApiText.indexOf(marker);
  const unsafe = `${openApiText.slice(0, start)}${openApiText
    .slice(start)
    .replace(
      '#/components/schemas/PublicRegistrationDocument',
      '#/components/schemas/RegistrationDocument',
    )}`;
  await assert.rejects(
    validateRotatingOpenApi({
      openApiText: unsafe,
      dataModel,
      config,
      platformOpenApiText,
    }),
    /public roster list must contain redacted registration documents/i,
  );
});

test("rejects non-exclusive registration identifiers", async () => {
  const marker = "    RegistrationCreateRequest:";
  const start = openApiText.indexOf(marker);
  const unsafe = `${openApiText.slice(0, start)}${openApiText
    .slice(start)
    .replace("      oneOf:", "      anyOf:")}`;
  await assert.rejects(
    validateRotatingOpenApi({
      openApiText: unsafe,
      dataModel,
      config,
      platformOpenApiText,
    }),
    /exclusive identifier rule: oneOf/,
  );
});