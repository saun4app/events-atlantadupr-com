import { expect, test } from "@playwright/test";
import { mockRotatingPartnerAdminApi } from "./fixtures/rotating-partner";

test("organizer can save rotating-partner rating settings", async ({
  page,
}) => {
  await mockRotatingPartnerAdminApi(page);
  await page.goto("/admin/events/rotating/1");

  await page.getByTestId("button-edit-event").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const maxRatingInput = dialog.getByTestId("input-edit-rating-max");
  await expect(maxRatingInput).toHaveValue("4");
  await maxRatingInput.fill("4.5");

  const updateRequestPromise = page.waitForRequest(
    (request) =>
      request.url().includes("/api/events/rotating/1") &&
      request.method() === "PATCH",
  );
  await page.getByTestId("button-submit-edit-event").click();

  const updateRequest = await updateRequestPromise;
  const payload = JSON.parse(updateRequest.postData() ?? "{}");
  expect(payload).toMatchObject({
    ratingTypeRequired: "dupr",
    ratingConfig: {
      min: 2,
      max: 4.5,
      nrAllowed: false,
    },
  });

  await expect(dialog).toBeHidden();
  await page.getByTestId("button-edit-event").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByTestId("input-edit-rating-max"),
  ).toHaveValue("4.5");
});