import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateRotatingOpenApi } from "./check-rotating-openapi.mjs";

const [openApiText, dataModel, config] = await Promise.all([
  readFile("api-docs/rotating-partner-event-openapi.yaml", "utf8"),
  readFile("api-docs/rotating-partner-event-data-model.json", "utf8").then(JSON.parse),
  readFile("api-docs/rotating-partner-event-config.json", "utf8").then(JSON.parse),
]);

test("accepts the standalone rotating OpenAPI contract", async () => {
  const result = await validateRotatingOpenApi({ openApiText, dataModel, config });
  assert.ok(result.operations > 0);
  assert.ok(result.localReferences > 0);
});

test("rejects a full registration document on a public registration response", async () => {
  const unsafe = openApiText.replace(
    '#/components/schemas/PublicRegistrationDocument',
    '#/components/schemas/RegistrationDocument',
  );
  await assert.rejects(
    validateRotatingOpenApi({ openApiText: unsafe, dataModel, config }),
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
    validateRotatingOpenApi({ openApiText: unsafe, dataModel, config }),
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
    validateRotatingOpenApi({ openApiText: unsafe, dataModel, config }),
    /exclusive identifier rule: oneOf/,
  );
});