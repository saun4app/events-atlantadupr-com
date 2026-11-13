import { expect, test, type Page } from "@playwright/test";
import {
  mockCloneEventApi,
  type CloneEventFormat,
} from "./fixtures/clone-event";

const EVENT_FORMATS: Array<{ format: CloneEventFormat; label: string }> = [
  { format: "rotating", label: "rotating-partner" },
  { format: "fixed_partner", label: "fixed-partner" },
];

for (const { format, label } of EVENT_FORMATS) {
  test(`clone-event filtering works for ${label} create flow`, async ({
    page,
  }) => {
    await mockCloneEventApi(page, format);
    await page.goto(`/admin/events/${format}/new`);

    await expect(
      page.getByRole("heading", { name: "Create New Event" }),
    ).toBeVisible();

    const trigger = page.getByTestId("select-clone-event");
    await trigger.click();

    const filter = page.getByTestId("input-clone-event-filter");
    await expect(filter).toBeVisible();
    await expect(page.getByRole("option")).toHaveText([
      "None — start fresh",
      "Newest Smash",
      "Court Rally",
      "Older Smash",
    ]);

    await filter.fill("  sMaSh  ");
    await expect(page.getByRole("option")).toHaveText([
      "None — start fresh",
      "Newest Smash",
      "Older Smash",
    ]);
    await expect(page.getByRole("option", { name: "Court Rally" })).toHaveCount(
      0,
    );

    await filter.fill("does not exist");
    await expect(page.getByRole("status")).toHaveText("No matching events");
    await expect(
      page.getByRole("option", { name: "None — start fresh" }),
    ).toBeVisible();
    await expect(page.getByRole("option")).toHaveCount(1);

    await filter.press("Escape");
    await expect(filter).toBeHidden();

    await trigger.click();
    await expect(filter).toHaveValue("");
    await expect(page.getByRole("option")).toHaveText([
      "None — start fresh",
      "Newest Smash",
      "Court Rally",
      "Older Smash",
    ]);
  });
}


function collectCreateRequests(page: Page, format: CloneEventFormat) {
  const requests: Array<{ method: string; payload: Record<string, unknown> }> =
    [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname === `/api/events/${format}` &&
      request.method() === "POST"
    ) {
      requests.push({
        method: request.method(),
        payload: JSON.parse(request.postData() ?? "{}"),
      });
    }
  });
  return requests;
}

async function fillCloneRequiredFields(page: Page) {
  await page.getByTestId("input-event-start").click();
  await page.locator("button[data-day]").first().click();
  await page.locator('input[type="time"]').nth(0).fill("18:00");

  await page.getByTestId("input-signup-start").click();
  await page.locator("button[data-day]").first().click();
  await page.locator('input[type="time"]').nth(2).fill("09:00");
}

for (const { format, label } of EVENT_FORMATS) {
  test(`inverted limits from a ${label} clone are validated before create`, async ({
    page,
  }) => {
    await mockCloneEventApi(page, format);
    const createRequests = collectCreateRequests(page, format);
    await page.goto(`/admin/events/${format}/new`);

    await expect(
      page.getByRole("heading", { name: "Create New Event" }),
    ).toBeVisible();

    await page.getByTestId("select-clone-event").click();
    await page.getByRole("option", { name: "Newest Smash" }).click();
    await expect(page.getByTestId("input-min-participants")).toHaveValue("20");
    await expect(page.getByTestId("input-max-participants")).toHaveValue("10");

    const expectedError =
      format === "rotating"
        ? "Minimum participants cannot exceed maximum participants."
        : "Minimum teams cannot exceed maximum teams.";
    await expect(page.getByTestId("event-limit-error")).toHaveText(
      expectedError,
    );

    await fillCloneRequiredFields(page);
    await page.getByTestId("button-submit-event").click();
    await expect.poll(() => createRequests.length).toBe(0);

    await page.getByTestId("input-max-participants").fill("24");
    await expect(page.getByTestId("event-limit-error")).toBeHidden();
    await page.getByTestId("button-submit-event").click();

    await expect.poll(() => createRequests.length).toBe(1);
    expect(createRequests[0]).toMatchObject({
      method: "POST",
      payload:
        format === "rotating"
          ? { minParticipants: 20, maxParticipants: 24 }
          : { minTeams: 20, maxTeams: 24 },
    });
  });
}