import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { format } from "prettier";

const OPENAPI_PATH = "api-docs/rotating-partner-event-api-module-openapi.yaml";
const DATA_MODEL_PATH =
  "api-docs/rotating-partner-event-api-module-data-model.json";
const CONFIG_PATH = "api-docs/rotating-partner-event-api-module-config.json";
const PLATFORM_OPENAPI_PATH = "api-docs/dupr-event-api-openapi.yaml";
const PLATFORM_DATA_MODEL_PATH = "api-docs/dupr-event-api-data-model.json";
const PLATFORM_CONFIG_PATH = "api-docs/dupr-event-api-config.json";

const CONTRACT_FILENAME_RULES = [
  {
    label: "shared data model",
    canonicalPath: PLATFORM_DATA_MODEL_PATH,
    stalePaths: [`api-docs/dupr-event-api-data-${"modle"}.json`],
  },
  {
    label: "rotating module data model",
    canonicalPath: DATA_MODEL_PATH,
    stalePaths: [
      `api-docs/rotating-partner-event-api-module-data-${"modle"}.json`,
      `api-docs/rotating-partner-event-data-${"model"}.json`,
      `api-docs/rotating-partner-event-data-${"modle"}.json`,
    ],
  },
];

const IGNORED_REPOSITORY_DIRECTORIES = new Set([
  ".agents",
  ".git",
  ".local",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".cache",
]);

const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

function normalizeRepositoryPath(repositoryPath) {
  return repositoryPath.split(sep).join("/");
}

function isTextRepositoryPath(repositoryPath) {
  const normalizedPath = normalizeRepositoryPath(repositoryPath);
  if (
    normalizedPath.startsWith("api-docs/") ||
    normalizedPath.startsWith("scripts/")
  ) {
    return true;
  }
  const extension = normalizedPath
    .slice(normalizedPath.lastIndexOf("."))
    .toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(extension);
}

async function readRepositoryTextFiles(rootDirectory) {
  const fileContents = new Map();

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (
          entry.isDirectory() &&
          IGNORED_REPOSITORY_DIRECTORIES.has(entry.name)
        ) {
          return;
        }

        const absolutePath = join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(absolutePath);
          return;
        }
        if (!entry.isFile()) {
          return;
        }

        const repositoryPath = normalizeRepositoryPath(
          relative(rootDirectory, absolutePath),
        );
        if (isTextRepositoryPath(repositoryPath)) {
          fileContents.set(
            repositoryPath,
            await readFile(absolutePath, "utf8"),
          );
        }
      }),
    );
  }

  await visit(rootDirectory);
  return fileContents;
}

export function validateDocumentationFilenames({ files, fileContents }) {
  const presentFiles = new Set(files);
  const contents =
    fileContents instanceof Map
      ? fileContents
      : new Map(Object.entries(fileContents ?? {}));

  for (const { label, canonicalPath, stalePaths } of CONTRACT_FILENAME_RULES) {
    if (!presentFiles.has(canonicalPath)) {
      throw new Error(
        `Missing canonical ${label} contract filename "${canonicalPath}"`,
      );
    }

    for (const stalePath of stalePaths) {
      const staleFilename = stalePath.slice(stalePath.lastIndexOf("/") + 1);
      const referrers = [...contents.entries()]
        .filter(
          ([, text]) =>
            text.includes(stalePath) || text.includes(staleFilename),
        )
        .map(([filePath]) => filePath);
      const staleFilePresent = presentFiles.has(stalePath);
      if (!staleFilePresent && referrers.length === 0) {
        continue;
      }

      const locations = [];
      if (staleFilePresent) {
        locations.push(`file "${stalePath}"`);
      }
      if (referrers.length > 0) {
        locations.push(
          `referenced by file(s) ${referrers.map((filePath) => `"${filePath}"`).join(", ")}`,
        );
      }
      throw new Error(
        `Stale ${label} contract filename "${stalePath}" found in ${locations.join(
          " and ",
        )}. Use "${canonicalPath}" instead.`,
      );
    }
  }

  return {
    canonicalPaths: CONTRACT_FILENAME_RULES.map(
      ({ canonicalPath }) => canonicalPath,
    ),
  };
}

function readYamlScalar(line, key) {
  const match = line.match(
    new RegExp(`^\\s*${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^\\s#]+))`),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function collectDocumentationReferences(text) {
  const references = [];
  const lines = text.split(/\r?\n/);
  let externalDocsIndent = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const indentation = line.length - line.trimStart().length;
    if (externalDocsIndent !== null && indentation <= externalDocsIndent) {
      externalDocsIndent = null;
    }
    if (trimmed === "externalDocs:") {
      externalDocsIndent = indentation;
      continue;
    }
    if (externalDocsIndent !== null && indentation > externalDocsIndent) {
      const url = readYamlScalar(line, "url");
      if (url) {
        references.push({ kind: "documentation", value: url });
      }
    }
  }

  for (const match of text.matchAll(
    /\$ref:\s*(?:"([^"]+)"|'([^']+)'|([^\s,#]+))/g,
  )) {
    references.push({
      kind: "OpenAPI",
      value: match[1] ?? match[2] ?? match[3],
    });
  }

  for (const line of lines) {
    const match = line.match(
      /^\s*x-[A-Za-z0-9_-]+:\s*(?:"([^"]+)"|'([^']+)'|((?:\.\.?\/)[^\s#]+))/,
    );
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    if (value) {
      references.push({ kind: "documentation", value });
    }
  }

  return references;
}

function maskMarkdownCode(text) {
  const lines = text.split(/\r?\n/);
  const maskedLines = [];
  let fence = null;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.character &&
        fenceMatch[1].length >= fence.length
      ) {
        fence = null;
      }
      maskedLines.push("");
      continue;
    }

    if (fenceMatch) {
      fence = {
        character: fenceMatch[1][0],
        length: fenceMatch[1].length,
      };
      maskedLines.push("");
      continue;
    }

    maskedLines.push(
      line.replace(/(`+)(.*?)\1/g, (match) => " ".repeat(match.length)),
    );
  }

  return maskedLines.join("\n");
}

function collectMarkdownReferences(text) {
  const references = [];
  const definitions = [];
  const markdownText = maskMarkdownCode(text);
  const markdownLinkPattern =
    /(?<!!)\[[^\]\n]*\]\(\s*(?:<([^>\n]*)>|([^\s)\n]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;

  for (const match of markdownText.matchAll(markdownLinkPattern)) {
    references.push({
      kind: "Markdown",
      value: match[1] ?? match[2],
    });
  }

  const markdownReferenceLinkPattern =
    /(?<!!)\[([^\]\n]*)\]\[\s*([^\]\n]*?)\s*\]/g;
  for (const match of markdownText.matchAll(markdownReferenceLinkPattern)) {
    references.push({
      kind: "Markdown reference",
      label: match[2] || match[1],
    });
  }

  const markdownReferenceDefinitionPattern =
    /^[ \t]{0,3}\[(?!\^)([^\]\n]+)\]:\s*(?:<([^>\n]*)>|([^\s\n]+))/gm;
  for (const match of markdownText.matchAll(
    markdownReferenceDefinitionPattern,
  )) {
    const line = markdownText.slice(0, match.index).split("\n").length;
    definitions.push({
      label: match[1],
      value: match[2] ?? match[3],
      line,
    });
  }

  return { references, definitions };
}

function normalizeMarkdownReferenceLabel(label) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function displayMarkdownReferenceLabel(label) {
  return [...label]
    .map((character) => {
      if (character === " ") {
        return "·";
      }
      if (character === "\t") {
        return "⇥";
      }
      if (/\s/u.test(character)) {
        return `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`;
      }
      return character;
    })
    .join("");
}

function resolveRepositoryReference(referrer, reference) {
  const target = reference.split(/[?#]/, 1)[0];
  if (
    !target ||
    target.startsWith("/") ||
    target.startsWith("//") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
  ) {
    return null;
  }

  return posix.normalize(posix.join(dirname(referrer), target));
}

export function validateDocumentationReferences({ files, fileContents }) {
  const presentFiles = new Set(
    files.map((filePath) => normalizeRepositoryPath(filePath)),
  );
  const contents =
    fileContents instanceof Map
      ? fileContents
      : new Map(Object.entries(fileContents ?? {}));
  const unresolvedReferences = [];
  const markdownReferenceErrors = [];
  let referenceCount = 0;

  for (const [rawReferrer, text] of contents.entries()) {
    const referrer = normalizeRepositoryPath(rawReferrer);
    if (!referrer.startsWith("api-docs/")) {
      continue;
    }

    const markdownReferences = referrer.endsWith(".md")
      ? collectMarkdownReferences(text)
      : { references: [], definitions: [] };
    const definitionsByLabel = new Map();
    for (const definition of markdownReferences.definitions) {
      const normalizedLabel = normalizeMarkdownReferenceLabel(definition.label);
      const previousDefinition = definitionsByLabel.get(normalizedLabel);
      if (previousDefinition) {
        markdownReferenceErrors.push(
          `Duplicate Markdown reference definition label "${definition.label}" in file "${referrer}" at line ${definition.line} (previous definition at line ${previousDefinition.line}); normalized label "${normalizedLabel}" matches current label "${displayMarkdownReferenceLabel(definition.label)}" and previous label "${displayMarkdownReferenceLabel(previousDefinition.label)}"`,
        );
      } else {
        definitionsByLabel.set(normalizedLabel, definition);
      }
    }

    const references = [...collectDocumentationReferences(text)];
    for (const reference of references) {
      const targetPath = resolveRepositoryReference(referrer, reference.value);
      if (!targetPath) {
        continue;
      }
      referenceCount += 1;
      if (!presentFiles.has(targetPath)) {
        unresolvedReferences.push({
          kind: reference.kind,
          targetPath,
          referrer,
          value: reference.value,
        });
      }
    }

    for (const definition of markdownReferences.definitions) {
      const targetPath = resolveRepositoryReference(referrer, definition.value);
      if (!targetPath) {
        continue;
      }
      if (!presentFiles.has(targetPath)) {
        unresolvedReferences.push({
          kind: "Markdown",
          targetPath,
          referrer,
          value: definition.value,
        });
      }
    }

    for (const reference of markdownReferences.references) {
      if (reference.kind !== "Markdown reference") {
        const targetPath = resolveRepositoryReference(
          referrer,
          reference.value,
        );
        if (!targetPath) {
          continue;
        }
        referenceCount += 1;
        if (!presentFiles.has(targetPath)) {
          unresolvedReferences.push({
            kind: reference.kind,
            targetPath,
            referrer,
            value: reference.value,
          });
        }
        continue;
      }

      const label = reference.label.trim();
      const definition = definitionsByLabel.get(
        normalizeMarkdownReferenceLabel(label),
      );
      if (!definition) {
        markdownReferenceErrors.push(
          `Undefined Markdown reference label "${label}" referenced by document "${referrer}"`,
        );
        continue;
      }

      const targetPath = resolveRepositoryReference(referrer, definition.value);
      if (!targetPath) {
        continue;
      }
      referenceCount += 1;
      if (!presentFiles.has(targetPath)) {
        unresolvedReferences.push({
          kind: "Markdown",
          targetPath,
          referrer,
          value: definition.value,
        });
      }
    }
  }

  if (markdownReferenceErrors.length > 0 || unresolvedReferences.length > 0) {
    throw new Error(
      [
        ...markdownReferenceErrors,
        ...unresolvedReferences.map(
          ({ kind, targetPath, referrer, value }) =>
            `Unresolved ${kind} reference target "${targetPath}" from file "${referrer}" (reference "${value}")`,
        ),
      ].join("; "),
    );
  }

  return { referenceCount };
}

async function validateRepositoryDocumentation(rootDirectory = resolve(".")) {
  const fileContents = await readRepositoryTextFiles(rootDirectory);
  const files = [...fileContents.keys()];
  validateDocumentationFilenames({
    files,
    fileContents,
  });
  return validateDocumentationReferences({
    files,
    fileContents,
  });
}

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
  return text.slice(
    start,
    nextMatch ? start + marker.length + nextMatch.index : text.length,
  );
}

function assertIncludes(text, fragment, message) {
  if (!text.includes(fragment)) {
    throw new Error(message);
  }
}

export async function validateSharedApiContracts({
  openApiText,
  dataModel,
  config,
}) {
  await format(openApiText, { parser: "yaml" });

  assertIncludes(
    openApiText,
    "openapi: 3.1.0",
    "Shared OpenAPI version must be 3.1.0",
  );
  assertIncludes(
    openApiText,
    "title: DUPR Event API Server",
    "Shared OpenAPI title is missing",
  );
  for (const component of [
    "bearerAuth",
    "sessionCookieAuth",
    "Page",
    "PageSize",
    "IfMatch",
    "BadRequest",
    "Unauthorized",
    "Forbidden",
    "NotFound",
    "Conflict",
    "RateLimited",
    "UnprocessableEntity",
    "ServiceUnavailable",
    "DocumentEnvelope",
    "Problem",
  ]) {
    assertIncludes(
      openApiText,
      `    ${component}:`,
      `Shared OpenAPI component is missing: ${component}`,
    );
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
    throw new Error(
      `Shared OpenAPI has unresolved local references: ${[...new Set(unresolvedRefs)].join(", ")}`,
    );
  }

  if (config.server.basePath !== "/api/v1") {
    throw new Error(
      "Shared API configuration must use /api/v1 as its base path",
    );
  }
  if (
    config.authentication.bearer.issuerEnv !== "OIDC_ISSUER_URL" ||
    config.authentication.bearer.audienceEnv !== "OIDC_AUDIENCE"
  ) {
    throw new Error(
      "Shared API configuration is missing the OIDC environment contract",
    );
  }
  if (config.authentication.organization.tenantIdEnv !== "TENANT_ID") {
    throw new Error(
      "Shared API configuration is missing the tenant environment contract",
    );
  }
  if (
    config.http.allowedOriginsEnv !== "ALLOWED_ORIGINS" ||
    config.http.csrfHeader !== "X-CSRF-Token"
  ) {
    throw new Error(
      "Shared API configuration is missing the origin or CSRF contract",
    );
  }
  if (!dataModel.documentEnvelope?.requiredFields?.includes("module")) {
    throw new Error(
      "Shared data model must define module-owned document envelopes",
    );
  }
  const platformDocumentTypes = new Set(
    dataModel.platformDocuments?.map((document) => document.documentType),
  );
  for (const documentType of [
    "platform_outbox_message",
    "platform_audit_record",
  ]) {
    if (!platformDocumentTypes.has(documentType)) {
      throw new Error(
        `Shared data model is missing platform document type ${documentType}`,
      );
    }
  }

  return {
    localReferences: localRefs.length,
    platformDocuments: platformDocumentTypes.size,
  };
}

export async function validateRotatingOpenApi({
  openApiText,
  dataModel,
  config,
  platformOpenApiText,
}) {
  await format(openApiText, { parser: "yaml" });

  assertIncludes(
    openApiText,
    "openapi: 3.1.0",
    "OpenAPI version must be 3.1.0",
  );
  assertIncludes(
    openApiText,
    "x-rotating-partner-config: ./rotating-partner-event-api-module-config.json",
    "The contract must point to the rotating backend configuration",
  );
  assertIncludes(
    openApiText,
    "x-rotating-partner-data-model: ./rotating-partner-event-api-module-data-model.json",
    "The contract must point to the rotating JSON data model",
  );
  assertIncludes(
    openApiText,
    "x-dupr-event-api-platform: ./dupr-event-api-openapi.yaml",
    "The rotating module must point to the shared API platform contract",
  );
  if (!platformOpenApiText) {
    throw new Error(
      "The rotating module validator requires the shared API OpenAPI contract",
    );
  }

  for (const reference of [
    "./dupr-event-api-openapi.yaml#/components/securitySchemes/bearerAuth",
    "./dupr-event-api-openapi.yaml#/components/securitySchemes/sessionCookieAuth",
    "./dupr-event-api-openapi.yaml#/components/parameters/Page",
    "./dupr-event-api-openapi.yaml#/components/parameters/PageSize",
    "./dupr-event-api-openapi.yaml#/components/parameters/IfMatch",
    "./dupr-event-api-openapi.yaml#/components/responses/BadRequest",
    "./dupr-event-api-openapi.yaml#/components/responses/Unauthorized",
    "./dupr-event-api-openapi.yaml#/components/responses/Forbidden",
    "./dupr-event-api-openapi.yaml#/components/responses/NotFound",
    "./dupr-event-api-openapi.yaml#/components/responses/Conflict",
    "./dupr-event-api-openapi.yaml#/components/responses/RateLimited",
    "./dupr-event-api-openapi.yaml#/components/responses/UnprocessableEntity",
    "./dupr-event-api-openapi.yaml#/components/responses/ServiceUnavailable",
    "./dupr-event-api-openapi.yaml#/components/schemas/DocumentEnvelope",
    "./dupr-event-api-openapi.yaml#/components/schemas/Problem",
  ]) {
    assertIncludes(
      openApiText,
      reference,
      `The rotating module must resolve shared component ${reference}`,
    );
  }

  if (
    openApiText.includes("fixed_partner") ||
    openApiText.includes("frontend_event_create")
  ) {
    throw new Error(
      "The standalone rotating contract contains a non-rotating rule",
    );
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
    throw new Error(
      `Unresolved local references: ${[...new Set(unresolvedRefs)].join(", ")}`,
    );
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

  const templatedPaths = [
    ...openApiText.matchAll(/^  (\/[^:]*\{([^}]+)\}[^:]*):$/gm),
  ];
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
    const block = openApiText.slice(
      start,
      next === -1 ? openApiText.length : next,
    );
    const expectedRef = pathParameterRefs[parameterName];
    if (!expectedRef || !block.includes(expectedRef)) {
      throw new Error(
        `Path ${path} does not declare parameter ${parameterName}`,
      );
    }
  }

  const publicRegistrationOperations = [
    "createRotatingRegistration",
    "cancelRotatingRegistrationByParticipant",
  ];
  for (const operationId of publicRegistrationOperations) {
    const block = operationBlock(openApiText, operationId);
    assertIncludes(
      block,
      "security: []",
      `${operationId} must declare its public access`,
    );
    assertIncludes(
      block,
      "#/components/schemas/PublicRegistrationDocument",
      `${operationId} must return the redacted public registration document`,
    );
    if (block.includes('#/components/schemas/RegistrationDocument"')) {
      throw new Error(`${operationId} exposes the full registration document`);
    }
  }

  const publicListBlock = operationBlock(
    openApiText,
    "listRotatingRegistrations",
  );
  assertIncludes(
    publicListBlock,
    "security: []",
    "The public roster list must explicitly declare public access",
  );
  const publicListSchema = schemaBlock(openApiText, "RegistrationListResponse");
  assertIncludes(
    publicListSchema,
    "#/components/schemas/PublicRegistrationDocument",
    "The public roster list must contain redacted registration documents",
  );

  const privateRegistrationBlock = operationBlock(
    openApiText,
    "getRotatingRegistration",
  );
  if (privateRegistrationBlock.includes("security: []")) {
    throw new Error(
      "Full registration documents cannot be fetched anonymously",
    );
  }
  assertIncludes(
    privateRegistrationBlock,
    "x-required-roles:",
    "Full registration lookup must require a staff role",
  );
  assertIncludes(
    privateRegistrationBlock,
    "#/components/schemas/RegistrationDocument",
    "Staff registration lookup must use the full registration schema",
  );

  const publicProfile = schemaBlock(openApiText, "PublicPlayerProfile");
  for (const privateField of ["email:", "phone:", "participantId:"]) {
    if (publicProfile.includes(privateField)) {
      throw new Error(
        `PublicPlayerProfile exposes private field ${privateField.slice(0, -1)}`,
      );
    }
  }

  const registrationInput = schemaBlock(
    openApiText,
    "RegistrationCreateRequest",
  );
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
  if (
    registrationInput.includes(
      'type: [string, "null"]\n          format: email',
    )
  ) {
    throw new Error("Registration email identifier cannot be null");
  }

  if (config.module.apiBasePath !== "/api/v1/rotating-partner-events") {
    throw new Error(
      "OpenAPI server base path does not match the backend configuration",
    );
  }
  assertIncludes(
    openApiText,
    `url: ${config.module.apiBasePath}`,
    "OpenAPI server URL does not match the backend configuration",
  );

  const documentTypes = new Set(
    dataModel.documentEnvelope.fields.documentType.enum,
  );
  for (const documentType of [
    "rotating_event",
    "rotating_registration",
    "participant_profile",
    "rotating_event_defaults",
    "event_assignment",
  ]) {
    if (
      !documentTypes.has(documentType) ||
      !openApiText.includes(`const: ${documentType}`)
    ) {
      throw new Error(
        `OpenAPI contract is missing document type ${documentType}`,
      );
    }
  }

  const registrationModel = dataModel.documents.find(
    (document) => document.documentType === "rotating_registration",
  );
  const registrationStatuses = registrationModel.fields.find(
    (field) => field.path === "status",
  ).enum;
  const registrationStatusSchema = schemaBlock(
    openApiText,
    "RegistrationStatus",
  );
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
  await validateRepositoryDocumentation();
  const [
    openApiText,
    dataModelText,
    configText,
    platformOpenApiText,
    platformDataModelText,
    platformConfigText,
  ] = await Promise.all([
    readFile(OPENAPI_PATH, "utf8"),
    readFile(DATA_MODEL_PATH, "utf8"),
    readFile(CONFIG_PATH, "utf8"),
    readFile(PLATFORM_OPENAPI_PATH, "utf8"),
    readFile(PLATFORM_DATA_MODEL_PATH, "utf8").then(JSON.parse),
    readFile(PLATFORM_CONFIG_PATH, "utf8").then(JSON.parse),
  ]);
  const sharedResult = await validateSharedApiContracts({
    openApiText: platformOpenApiText,
    dataModel: platformDataModelText,
    config: platformConfigText,
  });
  const result = await validateRotatingOpenApi({
    openApiText,
    dataModel: JSON.parse(dataModelText),
    config: JSON.parse(configText),
    platformOpenApiText,
  });
  console.log(
    `Validated shared API and rotating module OpenAPI: ${result.operations} rotating operations, ${result.localReferences} module local references, ${sharedResult.platformDocuments} platform document types, ${result.registrationStatuses} registration statuses.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`::error::API contract validation failed: ${error.message}`);
    process.exit(1);
  });
}
