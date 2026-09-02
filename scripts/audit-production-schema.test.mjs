import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

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
  assert.match(auditScript, /const check = args\.includes\("--check"\)/);
  assert.match(
    auditScript,
    /Production schema check failed[\s\S]+?process\.exitCode = 1/,
  );
});
