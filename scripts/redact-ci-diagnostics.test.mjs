import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  findSensitiveValues,
  redactDiagnostics,
  redactSensitiveValues,
} from "./redact-ci-diagnostics.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const sensitiveValues = [
  "postgresql://admin:db-password@database.example.com:5432/app",
  "postgres://admin:db-password@database.example.com/app",
  "mysql://root:mysql-password@database.example.com/app",
  "mongodb+srv://mongo:mongo-password@cluster.example.com/app",
  "redis://default:redis-password@cache.example.com:6379/0",
  "Authorization: Bearer bearer-token-value",
  "authorization: Basic dXNlcjpwYXNzd29yZA==",
  '"authorization": "Bearer json-bearer-token"',
  "password=plain-password",
  "secret: plain-secret",
  "token=plain-token",
  "api_key: plain-api-key",
  "api-key=plain-api-key",
  '"password": "json-password"',
  "'token': 'quoted-token'",
];

test("redacts representative connection URLs and credentials", () => {
  const input = sensitiveValues.join("\n");
  const redacted = redactSensitiveValues(input);

  assert.deepEqual(findSensitiveValues(redacted), []);
  for (const secret of [
    "db-password",
    "mysql-password",
    "mongo-password",
    "redis-password",
    "bearer-token-value",
    "dXNlcjpwYXNzd29yZA==",
    "json-bearer-token",
    "plain-password",
    "plain-secret",
    "plain-token",
    "plain-api-key",
    "json-password",
    "quoted-token",
  ]) {
    assert.equal(redacted.includes(secret), false);
  }
  assert.match(redacted, /\[REDACTED_DATABASE_URL\]/);
  assert.match(redacted, /Authorization: Bearer \[REDACTED\]/);
  assert.match(redacted, /password=\[REDACTED\]/);
});

test("redacts and checks every diagnostics file recursively", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ci-diagnostics-"));
  const nested = join(directory, "nested");
  await mkdir(nested);
  await writeFile(join(directory, "api.log"), sensitiveValues.join("\n"));
  await writeFile(
    join(nested, "report.xml"),
    '<failure message="token=xml-token">postgresql://user:pass@db/app</failure>',
  );

  await redactDiagnostics(directory);

  for (const file of [join(directory, "api.log"), join(nested, "report.xml")]) {
    assert.deepEqual(findSensitiveValues(await readFile(file, "utf8")), []);
  }
});

test("detects sensitive values before diagnostics are uploaded", () => {
  for (const value of sensitiveValues) {
    assert.notDeepEqual(
      findSensitiveValues(`diagnostic output: ${value}`),
      [],
      `expected leak detection for ${value.split(/[=:]/, 1)[0]}`,
    );
  }
});

test("CI uploads API diagnostics only after redaction succeeds", async () => {
  const workflow = await readFile(
    join(repositoryRoot, ".github/workflows/api-tests.yml"),
    "utf8",
  );

  assert.match(workflow, /id: redact-api-test-diagnostics/);
  assert.match(
    workflow,
    /if: failure\(\) && steps\.redact-api-test-diagnostics\.outcome == 'success'/,
  );
});

test("CI runs both browser projects against an isolated database", async () => {
  const workflow = await readFile(
    join(repositoryRoot, ".github/workflows/api-tests.yml"),
    "utf8",
  );

  assert.match(workflow, /browser-tests:[\s\S]*?POSTGRES_DB: e2e_test/);
  assert.match(
    workflow,
    /TEST_DATABASE_URL: postgresql:\/\/postgres@127\.0\.0\.1:5432\/e2e_test/,
  );
  assert.match(
    workflow,
    /pnpm run test:e2e -- --project=desktop-chromium --project=mobile-chromium/,
  );
  assert.match(
    workflow,
    /PLAYWRIGHT_OUTPUT_DIR: \$\{\{ github\.workspace \}\}\/test-results\/playwright/,
  );
  assert.match(
    workflow,
    /if: failure\(\) && steps\.redact-browser-test-logs\.outcome == 'success'[\s\S]*?name: playwright-failure-diagnostics/,
  );
});
