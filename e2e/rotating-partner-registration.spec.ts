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

test("organizer can save rotating-partner numeric self-rating settings", async ({
  page,
}) => {
  await mockRotatingPartnerAdminApi(page, {
    ratingTypeRequired: "self_numeric",
    ratingConfig: { min: 2.5, max: 4.5 },
  });
  await page.goto("/admin/events/rotating/1");

  await page.getByTestId("button-edit-event").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const maxSelfRatingInput = dialog.getByTestId("input-edit-self-rating-max");
  await expect(maxSelfRatingInput).toHaveValue("4.5");
  await maxSelfRatingInput.fill("5.5");

  const updateRequestPromise = page.waitForRequest(
    (request) =>
      request.url().includes("/api/events/rotating/1") &&
      request.method() === "PATCH",
  );
  await page.getByTestId("button-submit-edit-event").click();

  const updateRequest = await updateRequestPromise;
  const payload = JSON.parse(updateRequest.postData() ?? "{}");
  expect(payload).toMatchObject({
    ratingTypeRequired: "self_numeric",
    ratingConfig: {
      min: 2.5,
      max: 5.5,
    },
  });

  await expect(dialog).toBeHidden();
  await expect(page.getByText("Self-Rating 2.5–5.5", { exact: true })).toBeVisible();
  await page.getByTestId("button-edit-event").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByTestId("input-edit-self-rating-max"),
  ).toHaveValue("5.5");
});

test("organizer can save rotating-partner skill-level self-rating settings", async ({
  page,
}) => {
  await mockRotatingPartnerAdminApi(page, {
    ratingTypeRequired: "self_skill",
    ratingConfig: { minLevel: 1, maxLevel: 2 },
  });
  await page.goto("/admin/events/rotating/1");

  await page.getByTestId("button-edit-event").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const maxSkillLevel = dialog.getByTestId("select-edit-self-rating-max");
  await expect(maxSkillLevel).toHaveText("Intermediate");
  await maxSkillLevel.click();
  await page.getByRole("option", { name: "Advanced", exact: true }).click();

  const updateRequestPromise = page.waitForRequest(
    (request) =>
      request.url().includes("/api/events/rotating/1") &&
      request.method() === "PATCH",
  );
  await page.getByTestId("button-submit-edit-event").click();

  const updateRequest = await updateRequestPromise;
  const payload = JSON.parse(updateRequest.postData() ?? "{}");
  expect(payload).toMatchObject({
    ratingTypeRequired: "self_skill",
    ratingConfig: {
      minLevel: 1,
      maxLevel: 3,
    },
  });

  await expect(dialog).toBeHidden();
  await expect(page.getByText("Skill: up to Advanced", { exact: true })).toBeVisible();
  await page.getByTestId("button-edit-event").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByTestId("select-edit-self-rating-max"),
  ).toHaveText("Advanced");
});
