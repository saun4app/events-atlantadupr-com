import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { auditProductionSchema } from "./audit-production-schema.ts";

const auditScript = await readFile(
  resolve(import.meta.dirname, "audit-production-schema.ts"),
  "utf8",
);

test("compares the app_users table and all expected users columns", () => {
  assert.match(auditScript, /table_name IN \('app_users', 'app_uses'\)/);
  for (const column of [
    "id",
    "name",
    "username",
    "password_hash",
    "role",
    "dupr_id",
    "dupr_fullname",
    "created_at",
  ]) {
    assert.match(auditScript, new RegExp(`name: "${column}"`));
  }
  assert.match(auditScript, /Missing expected table public\.app_users/);
  assert.match(auditScript, /Missing column public\.app_users/);
});

test("reports DUPR constraints and the preserved user count", () => {
  assert.match(auditScript, /FROM pg_constraint con/);
  assert.match(auditScript, /attr\.attname IN \('dupr_id', 'dupr_fullname'\)/);
  assert.match(auditScript, /Unexpected .*constraint/);
  assert.match(auditScript, /SELECT COUNT\(\*\)::int AS user_count/);
  assert.match(auditScript, /Preserved user count/);
});

test("inventories and validates users-table dependencies", () => {
  assert.match(auditScript, /Users-table dependency inventory/);
  assert.match(
    auditScript,
    /JOIN users_tables target ON target\.oid = con\.confrelid/,
  );
  assert.match(auditScript, /dep\.classid = 'pg_rewrite'::regclass/);
  assert.match(auditScript, /dep\.classid = 'pg_proc'::regclass/);
  assert.match(
    auditScript,
    /pg_get_functiondef\(routine\.oid\)[\s\S]+?app_uses/,
  );
  assert.match(auditScript, /atl_dupr_signups_approved_by_app_users_id_fk/);
  assert.match(auditScript, /atl_dupr_event_roles_user_id_app_users_id_fk/);
  assert.match(
    auditScript,
    /Stale [\s\S]* dependency [\s\S]*legacy public\.app_uses/,
  );
  assert.match(
    auditScript,
    /Unexpected [\s\S]* dependency [\s\S]*references public\.app_users/,
  );
  assert.match(auditScript, /Missing expected foreign key dependency/);
});

test("warns about rename-versus-destructive-create risk", () => {
  assert.match(auditScript, /destructive drop-and-create/);
  assert.match(auditScript, /legacy public\.app_uses exists/);
  assert.match(auditScript, /0004 rename/);
});

test("uses a read-only transaction and contains no write queries", () => {
  assert.match(auditScript, /SET TRANSACTION READ ONLY/);
  assert.doesNotMatch(
    auditScript,
    /\b(?:INSERT INTO|UPDATE\s+\w|DELETE FROM|ALTER TABLE|DROP TABLE|TRUNCATE)\b/i,
  );
});

test("supports a release-gating check mode", () => {
  assert.match(auditScript, /check: args\.includes\("--check"\)/);
  assert.match(auditScript, /Production schema check failed[\s\S]+?return 1/);
});

const healthyColumns = [
  ["id", "integer", "int4", "NO", "nextval('app_users_id_seq'::regclass)"],
  ["name", "text", "text", "NO", null],
  ["username", "text", "text", "NO", null],
  ["password_hash", "text", "text", "NO", null],
  ["role", "text", "text", "NO", "'club_member'::text"],
  ["dupr_id", "text", "text", "YES", null],
  ["dupr_fullname", "text", "text", "YES", null],
  ["created_at", "timestamp without time zone", "timestamp", "NO", "now()"],
].map(([column_name, data_type, udt_name, is_nullable, column_default]) => ({
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default,
}));

const healthyDependencies = [
  {
    dependency_type: "foreign key",
    dependent_schema: "public",
    dependent_name: "atl_dupr_signups",
    dependent_column: "approved_by",
    referenced_table: "app_users",
    detail: "atl_dupr_signups_approved_by_app_users_id_fk",
  },
  {
    dependency_type: "foreign key",
    dependent_schema: "public",
    dependent_name: "atl_dupr_event_roles",
    dependent_column: "user_id",
    referenced_table: "app_users",
    detail: "atl_dupr_event_roles_user_id_app_users_id_fk",
  },
];

function fixtureTransaction(responses) {
  const calls = [];
  return {
    calls,
    transaction: async (callback) =>
      callback({
        execute: async (query) => {
          calls.push(query);
          const response = responses.shift();
          assert.ok(response, `unexpected query number ${calls.length}`);
          return { rows: response };
        },
      }),
  };
}

async function runFixture(responses, check = true) {
  const output = [];
  const fixture = fixtureTransaction(structuredClone(responses));
  const exitCode = await auditProductionSchema({
    check,
    transaction: fixture.transaction,
    log: (message) => output.push(message),
    error: (message) => output.push(message),
  });
  return { exitCode, output: output.join("\n"), calls: fixture.calls };
}

test("passes a healthy app_users schema in check mode", async () => {
  const result = await runFixture([
    [],
    [{ table_name: "app_users" }],
    healthyColumns,
    [],
    healthyDependencies,
    [{ user_count: 12 }],
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.output, /app_users=present, legacy app_uses=absent/);
  assert.match(result.output, /Preserved user count: 12 row\(s\)/);
  assert.match(result.output, /Production schema check passed/);
  assert.equal(result.calls.length, 6);
});

test("fails check mode for the legacy rename-risk state", async () => {
  const result = await runFixture([
    [],
    [{ table_name: "app_uses" }],
    [],
    [],
    [],
    [{ user_count: 9 }],
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(result.output, /Missing expected table public\.app_users/);
  assert.match(result.output, /destructive drop-and-create/);
  assert.match(
    result.output,
    /legacy public\.app_uses; app_users has not been created/,
  );
});

test("reports missing columns and unexpected DUPR constraints", async () => {
  const columns = healthyColumns.filter(
    ({ column_name }) => column_name !== "dupr_fullname",
  );
  const result = await runFixture([
    [],
    [{ table_name: "app_users" }],
    columns,
    [
      {
        constraint_name: "app_users_dupr_id_key",
        constraint_type: "UNIQUE",
        definition: "UNIQUE (dupr_id)",
        column_name: "dupr_id",
      },
    ],
    [],
    [{ user_count: 4 }],
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(
    result.output,
    /Missing column public\.app_users\.dupr_fullname/,
  );
  assert.match(
    result.output,
    /Unexpected UNIQUE constraint app_users_dupr_id_key/,
  );
});

test("warns when current and legacy user counts differ", async () => {
  const result = await runFixture([
    [],
    [{ table_name: "app_users" }, { table_name: "app_uses" }],
    healthyColumns,
    [],
    healthyDependencies,
    [{ user_count: 11 }],
    [{ user_count: 14 }],
  ]);

  assert.equal(result.exitCode, 1);
  assert.match(
    result.output,
    /app_users contains 11 row\(s\), while legacy app_uses contains 14/,
  );
});

function queryText(value, seen = new Set()) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((part) => queryText(part, seen)).join(" ");
  }
  return Object.values(value)
    .map((part) => queryText(part, seen))
    .join(" ");
}

test("executes the read-only guard before every audit query", async () => {
  const result = await runFixture([
    [],
    [{ table_name: "app_users" }],
    healthyColumns,
    [],
    healthyDependencies,
    [{ user_count: 1 }],
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.calls.length, 6);
  assert.match(queryText(result.calls[0]), /SET TRANSACTION READ ONLY/);
});
