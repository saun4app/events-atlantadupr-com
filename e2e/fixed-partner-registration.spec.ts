import { expect, test, type Page } from "@playwright/test";
import { mockFixedPartnerAdminApi } from "./fixtures/fixed-partner";
import { mockEventDetailApi } from "./fixtures/event-detail";

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("fixed-partner public registration shows its partner and verification steps", async ({
  page,
}) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await mockEventDetailApi(page, "fixed_partner", "open");
  await page.goto("/events/fixed_partner/1");

  await expect(page.getByTestId("card-event-info")).toBeVisible();
  const partnerEmail = page.getByTestId("input-partner-email");
  await expect(partnerEmail).toBeVisible();

  await page.getByTestId("input-reg-email").fill("player@example.com");
  await partnerEmail.fill("partner@example.com");

  const requestPromise = page.waitForRequest(
    "**/api/events/fixed_partner/1/registrations/request-code",
  );
  await page.getByTestId("button-send-code").click();
  const request = await requestPromise;
  expect(JSON.parse(request.postData() ?? "{}")).toMatchObject({
    email: "player@example.com",
    partnerEmail: "partner@example.com",
  });
  await expect(page.getByTestId("input-reg-code")).toBeVisible();
  await expect(
    page.getByTestId("card-registration").getByText("Verification Code", {
      exact: true,
    }),
  ).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});

test("organizer fixed-partner event detail and edit form load cleanly", async ({
  page,
}) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await mockFixedPartnerAdminApi(page);
  await page.goto("/admin/events/fixed_partner/1");

  await expect(
    page.getByRole("heading", { name: "Fixed Partner organizer fixture" }),
  ).toBeVisible();
  await expect(page.getByText("Fixed-Partner")).toBeVisible();
  await expect(page.getByTestId("input-add-partner-email")).toBeVisible();

  await page.getByTestId("button-edit-event").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Edit Event" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Min Teams")).toHaveValue("2");
  await expect(dialog.getByLabel("Max Teams")).toHaveValue("8");
  await expect(page.getByTestId("button-submit-edit-event")).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});
