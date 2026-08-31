import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const OPENAPI_PATH = "api-docs/rotating-partner-event-openapi.yaml";
const DATA_MODEL_PATH = "api-docs/rotating-partner-event-data-model.json";
const CONFIG_PATH = "api-docs/rotating-partner-event-config.json";

function operationBlock(text, operationId) {
  const marker = `      operationId: ${operationId}`;
  const start = text.indexOf(marker);
  if (start === -1) {
    throw new Error(`Missing operationId: ${operationId}`);
  }
  const next = text.indexOf("\n      operationId:", start + marker.length);
  return text.slice(start, next === -1 ? text.length : next);
}

function schemaBlock(text, schemaName) {
  const marker = `    ${schemaName}:`;
  const start = text.lastIndexOf(marker);
  if (start === -1) {
    throw new Error(`Missing schema: ${schemaName}`);
  }
  const rest = text.slice(start + marker.length);
  const nextMatch = rest.match(/\n    [A-Za-z][A-Za-z0-9_-]*:\n/);
  return text.slice(start, nextMatch ? start + marker.length + nextMatch.index : text.length);
}

function assertIncludes(text, fragment, message) {
  if (!text.includes(fragment)) {
    throw new Error(message);
  }
}

export async function validateRotatingOpenApi({
  openApiText,
  dataModel,
  config,
}) {
  await format(openApiText, { parser: "yaml" });

  assertIncludes(openApiText, "openapi: 3.1.0", "OpenAPI version must be 3.1.0");
  assertIncludes(
    openApiText,
    "x-rotating-partner-config: ./rotating-partner-event-config.json",
    "The contract must point to the rotating backend configuration",
  );
  assertIncludes(
    openApiText,
    "x-rotating-partner-data-model: ./rotating-partner-event-data-model.json",
    "The contract must point to the rotating JSON data model",
  );

  if (openApiText.includes("fixed_partner") || openApiText.includes("frontend_event_create")) {
    throw new Error("The standalone rotating contract contains a non-rotating rule");
  }

  const declarations = new Set(
    [...openApiText.matchAll(/^    ([A-Za-z][A-Za-z0-9_-]*):$/gm)].map(
      (match) => match[1],
    ),
  );
  const localRefs = [
    ...openApiText.matchAll(
      /\$ref:\s*["']?#\/components\/(?:schemas|responses|parameters|securitySchemes)\/([A-Za-z0-9_-]+)/g,
    ),
  ].map((match) => match[1]);
  const unresolvedRefs = localRefs.filter((name) => !declarations.has(name));
  if (unresolvedRefs.length > 0) {
    throw new Error(`Unresolved local references: ${[...new Set(unresolvedRefs)].join(", ")}`);
  }

  const operationIds = [
    ...openApiText.matchAll(/^      operationId:\s*(\S+)$/gm),
  ].map((match) => match[1]);
  if (operationIds.length !== new Set(operationIds).size) {
    throw new Error("Operation IDs must be unique");
  }

  const requiredOperations = [
    "listRotatingEvents",
    "createRotatingEvent",
    "getRotatingEvent",
    "updateRotatingEvent",
    "getRotatingRosterSummary",
    "listRotatingRegistrations",
    "createRotatingRegistration",
    "requestRotatingRegistrationCode",
    "cancelRotatingRegistrationByParticipant",
    "getRotatingRegistration",
    "updateRotatingRegistration",
    "approveRotatingRegistration",
    "rejectRotatingRegistration",
    "promoteRotatingRegistration",
    "listRotatingParticipants",
    "listRotatingEventAssignments",
    "getRotatingEventDefaults",
    "broadcastRotatingEventEmail",
  ];
  for (const operationId of requiredOperations) {
    if (!operationIds.includes(operationId)) {
      throw new Error(`Required rotating operation is missing: ${operationId}`);
    }
  }

  const templatedPaths = [...openApiText.matchAll(/^  (\/[^:]*\{([^}]+)\}[^:]*):$/gm)];
  const pathParameterRefs = {
    eventId: "#/components/parameters/EventId",
    registrationId: "#/components/parameters/RegistrationId",
    participantId: "#/components/parameters/ParticipantId",
    assignmentId: "#/components/parameters/AssignmentId",
  };
  for (const [, path, parameterName] of templatedPaths) {
    const marker = `  ${path}:`;
    const start = openApiText.indexOf(marker);
    const next = openApiText.indexOf("\n  /", start + marker.length);
    const block = openApiText.slice(start, next === -1 ? openApiText.length : next);
    const expectedRef = pathParameterRefs[parameterName];
    if (!expectedRef || !block.includes(expectedRef)) {
      throw new Error(`Path ${path} does not declare parameter ${parameterName}`);
    }
  }

  const publicRegistrationOperations = [
    "createRotatingRegistration",
    "cancelRotatingRegistrationByParticipant",
  ];
  for (const operationId of publicRegistrationOperations) {
    const block = operationBlock(openApiText, operationId);
    assertIncludes(block, "security: []", `${operationId} must declare its public access`);
    assertIncludes(
      block,
      '#/components/schemas/PublicRegistrationDocument',
      `${operationId} must return the redacted public registration document`,
    );
    if (block.includes('#/components/schemas/RegistrationDocument"')) {
      throw new Error(`${operationId} exposes the full registration document`);
    }
  }

  const publicListBlock = operationBlock(openApiText, "listRotatingRegistrations");
  assertIncludes(
    publicListBlock,
    "security: []",
    "The public roster list must explicitly declare public access",
  );
  const publicListSchema = schemaBlock(openApiText, "RegistrationListResponse");
  assertIncludes(
    publicListSchema,
    '#/components/schemas/PublicRegistrationDocument',
    "The public roster list must contain redacted registration documents",
  );

  const privateRegistrationBlock = operationBlock(openApiText, "getRotatingRegistration");
  if (privateRegistrationBlock.includes("security: []")) {
    throw new Error("Full registration documents cannot be fetched anonymously");
  }
  assertIncludes(
    privateRegistrationBlock,
    "x-required-roles:",
    "Full registration lookup must require a staff role",
  );
  assertIncludes(
    privateRegistrationBlock,
    '#/components/schemas/RegistrationDocument',
    "Staff registration lookup must use the full registration schema",
  );

  const publicProfile = schemaBlock(openApiText, "PublicPlayerProfile");
  for (const privateField of ["email:", "phone:", "participantId:"]) {
    if (publicProfile.includes(privateField)) {
      throw new Error(`PublicPlayerProfile exposes private field ${privateField.slice(0, -1)}`);
    }
  }

  const registrationInput = schemaBlock(openApiText, "RegistrationCreateRequest");
  for (const fragment of [
    "oneOf:",
    "required: [email, code]",
    "required: [memberDuprId]",
    "not:",
    "type: string",
    "minLength: 1",
  ]) {
    assertIncludes(
      registrationInput,
      fragment,
      `RegistrationCreateRequest is missing exclusive identifier rule: ${fragment}`,
    );
  }
  if (registrationInput.includes("type: [string, \"null\"]\n          format: email")) {
    throw new Error("Registration email identifier cannot be null");
  }

  if (config.module.apiBasePath !== "/api/v1/rotating-partner-events") {
    throw new Error("OpenAPI server base path does not match the backend configuration");
  }
  assertIncludes(
    openApiText,
    `url: ${config.module.apiBasePath}`,
    "OpenAPI server URL does not match the backend configuration",
  );

  const documentTypes = new Set(dataModel.documentEnvelope.fields.documentType.enum);
  for (const documentType of [
    "rotating_event",
    "rotating_registration",
    "participant_profile",
    "rotating_event_defaults",
    "event_assignment",
  ]) {
    if (!documentTypes.has(documentType) || !openApiText.includes(`const: ${documentType}`)) {
      throw new Error(`OpenAPI contract is missing document type ${documentType}`);
    }
  }

  const registrationModel = dataModel.documents.find(
    (document) => document.documentType === "rotating_registration",
  );
  const registrationStatuses = registrationModel.fields.find(
    (field) => field.path === "status",
  ).enum;
  const registrationStatusSchema = schemaBlock(openApiText, "RegistrationStatus");
  for (const status of registrationStatuses) {
    assertIncludes(
      registrationStatusSchema,
      status,
      `Registration status ${status} is missing from OpenAPI`,
    );
  }

  return {
    operations: operationIds.length,
    localReferences: localRefs.length,
    registrationStatuses: registrationStatuses.length,
  };
}

async function main() {
  const [openApiText, dataModelText, configText] = await Promise.all([
    readFile(OPENAPI_PATH, "utf8"),
    readFile(DATA_MODEL_PATH, "utf8"),
    readFile(CONFIG_PATH, "utf8"),
  ]);
  const result = await validateRotatingOpenApi({
    openApiText,
    dataModel: JSON.parse(dataModelText),
    config: JSON.parse(configText),
  });
  console.log(
    `Validated rotating OpenAPI: ${result.operations} operations, ${result.localReferences} local references, ${result.registrationStatuses} registration statuses.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::Rotating OpenAPI validation failed: ${error.message}`);
    process.exit(1);
  });
}