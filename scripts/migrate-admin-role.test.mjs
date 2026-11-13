import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("./migrate-admin-role.ts", import.meta.url),
  "utf8",
);

test("admin role migration is targeted and non-destructive", () => {
  assert.match(migration, /UPDATE app_users/);
  assert.match(migration, /SET role = 'app_admin'/);
  assert.match(migration, /WHERE role = 'admin'/);
  assert.doesNotMatch(migration, /\b(?:DELETE FROM|DROP TABLE|TRUNCATE)\b/i);
});