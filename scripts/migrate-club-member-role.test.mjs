import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("./migrate-club-member-role.ts", import.meta.url),
  "utf8",
);

test("club member role migration is targeted and non-destructive", () => {
  assert.match(migration, /UPDATE app_users/);
  assert.match(migration, /SET role = 'club_member'/);
  assert.match(migration, /WHERE role = 'event_participant'/);
  assert.doesNotMatch(migration, /\b(?:DELETE FROM|DROP TABLE|TRUNCATE)\b/i);
});