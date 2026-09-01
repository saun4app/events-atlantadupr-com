import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const auditScript = await readFile(
  resolve(import.meta.dirname, "audit-event-assignments.ts"),
  "utf8",
);

test("audits registrations and assignments against their matching event tables", () => {
  assert.match(auditScript, /FROM atl_dupr_signups s/);
  assert.match(auditScript, /FROM atl_dupr_event_roles r/);
  assert.match(
    auditScript,
    /s\.event_type = 'rotating'[\s\S]+?atl_dupr_events_rotating[\s\S]+?rotating\.id = s\.event_id/,
  );
  assert.match(
    auditScript,
    /s\.event_type = 'fixed_partner'[\s\S]+?atl_dupr_events_fixed[\s\S]+?fixed\.id = s\.event_id/,
  );
  assert.match(
    auditScript,
    /r\.event_type = 'rotating'[\s\S]+?atl_dupr_events_rotating[\s\S]+?rotating\.id = r\.event_id/,
  );
  assert.match(
    auditScript,
    /r\.event_type = 'fixed_partner'[\s\S]+?atl_dupr_events_fixed[\s\S]+?fixed\.id = r\.event_id/,
  );
});

test("keeps cleanup explicit and transactional", () => {
  assert.match(auditScript, /const apply = args\.includes\("--apply"\)/);
  assert.match(auditScript, /return db\.transaction\(async \(tx\) =>/);
  assert.match(auditScript, /DELETE FROM atl_dupr_signups s/);
  assert.match(auditScript, /DELETE FROM atl_dupr_event_roles r/);
});

test("provides a read-only release check that blocks on orphan rows", () => {
  assert.match(auditScript, /const check = args\.includes\("--check"\)/);
  assert.match(auditScript, /if \(apply && check\) usage\(\)/);
  assert.match(
    auditScript,
    /if \(check && rows\.length > 0\)[\s\S]+?process\.exitCode = 1/,
  );
  assert.match(
    auditScript,
    /Event assignment integrity check failed; review the reported rows before release\./,
  );
});
