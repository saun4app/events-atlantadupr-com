import assert from "node:assert/strict";
import test from "node:test";
import siteNav from "../api-docs/site-nav.json" with { type: "json" };

function flatten(items) {
  return items.flatMap((item) => [item, ...flatten(item.children ?? [])]);
}

test("site navigation has unique short UUIDs and a nested events hierarchy", () => {
  assert.equal(siteNav.version, 1);

  const items = flatten(siteNav.items);
  const ids = items.map((item) => item.id);

  assert.equal(items.length, 7);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^[a-f0-9]{8}$/.test(id)));

  const manageEvents = siteNav.items.find((item) => item.label === "Manage Events");
  assert.ok(manageEvents);
  assert.deepEqual(
    manageEvents.children.map((item) => item.label),
    ["Rotating Partners", "Fixed-Partner", "New Event"],
  );
  assert.equal(manageEvents.href, "/admin/events/rotating");
  assert.equal(manageEvents.match.value, "/admin/events");
  assert.equal(manageEvents.testId, "manage-events");
});

test("site navigation preserves role visibility, route templates, and icons", () => {
  const items = flatten(siteNav.items);
  const byLabel = new Map(items.map((item) => [item.label, item]));

  assert.deepEqual(byLabel.get("Manage Events").roles, [
    "admin",
    "event_organizer",
    "event_captain",
    "court_leader",
  ]);
  assert.deepEqual(byLabel.get("Manage Members").roles, ["admin"]);
  assert.equal(byLabel.get("Manage Events").icon, "calendar");
  assert.equal(byLabel.get("Manage Members").icon, "users");
  assert.equal(byLabel.get("Manage Users").icon, "shield");
  assert.equal(byLabel.get("Settings").icon, "settings");
  assert.deepEqual(
    [...byLabel.values()].map((item) => item.testId),
    [
      "manage-events",
      "rotating",
      "fixed_partner",
      "new-event",
      "manage-members",
      "manage-users",
      "settings",
    ],
  );
  assert.equal(byLabel.get("New Event").hrefTemplate, "/admin/events/{eventType}/new");
  assert.equal(
    byLabel.get("New Event").match.valueTemplate,
    "/admin/events/{eventType}/new",
  );
});