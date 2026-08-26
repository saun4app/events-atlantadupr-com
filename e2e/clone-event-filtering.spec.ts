import { expect, test } from "@playwright/test";
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