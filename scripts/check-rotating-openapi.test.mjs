import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
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
  readFile("api-docs/rotating-partner-event-api-module-data-modle.json", "utf8").then(JSON.parse),
  readFile("api-docs/rotating-partner-event-api-module-config.json", "utf8").then(JSON.parse),
  readFile("api-docs/dupr-event-api-openapi.yaml", "utf8"),
  readFile("api-docs/dupr-event-api-data-modle.json", "utf8").then(JSON.parse),
  readFile("api-docs/dupr-event-api-config.json", "utf8").then(JSON.parse),
]);

test("accepts the shared API server contracts", async () => {
  const result = await validateSharedApiContracts({
    openApiText: platformOpenApiText,
    dataModel: platformDataModel,
    config: platformConfig,
  });
  assert.equal(result.platformDocuments, 2);
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