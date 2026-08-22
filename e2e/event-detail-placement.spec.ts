import { expect, test, type Locator } from "@playwright/test";
import {
  mockEventDetailApi,
  type EventDetailState,
  type EventFormat,
} from "./fixtures/event-detail";

async function expectImmediatelyAfter(
  first: Locator,
  second: Locator,
  following: Locator,
) {
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(following).toBeVisible();

  const [firstBox, secondBox, followingBox] = await Promise.all([
    first.boundingBox(),
    second.boundingBox(),
    following.boundingBox(),
  ]);

  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(followingBox).not.toBeNull();

  const firstBottom = firstBox!.y + firstBox!.height;
  const secondBottom = secondBox!.y + secondBox!.height;

  // The page uses a 24px flex gap. Keeping this bound tight detects a section
  // accidentally moving below the description or guidelines cards.
  expect(secondBox!.y - firstBottom).toBeGreaterThanOrEqual(20);
  expect(secondBox!.y - firstBottom).toBeLessThanOrEqual(28);
  expect(followingBox!.y - secondBottom).toBeGreaterThanOrEqual(20);
  expect(followingBox!.y).toBeGreaterThan(secondBox!.y);
}

async function openEventDetail(
  format: EventFormat,
  state: EventDetailState,
  page: Parameters<typeof mockEventDetailApi>[0],
) {
  await mockEventDetailApi(page, format, state);
  await page.goto(`/events/${format}/1`);
  await expect(page.getByTestId("card-event-info")).toBeVisible();
}

test("approval notice stays above event copy after a mocked open registration", async ({
  page,
}) => {
  await mockEventDetailApi(page, "rotating", "open", {
    requireApproval: "all",
  });
  await page.goto("/events/rotating/1");

  await page.getByTestId("input-reg-email").fill("placement@example.com");
  await page.getByTestId("button-send-code").click();
  await expect(page.getByTestId("input-reg-code")).toBeVisible();

  await page.getByTestId("input-reg-code").fill("123456");
  await page.getByTestId("button-register").click();
  await expect(page.getByTestId("notice-registration-approval")).toBeVisible();

  await expectImmediatelyAfter(
    page.getByTestId("card-registration"),
    page.getByTestId("control-cancel-registration"),
    page.getByTestId("notice-registration-approval"),
  );
  await expectImmediatelyAfter(
    page.getByTestId("control-cancel-registration"),
    page.getByTestId("notice-registration-approval"),
    page.getByTestId("card-event-description"),
  );
});

test("open rotating-partner registration and cancellation controls follow Event Info", async ({
  page,
}) => {
  await openEventDetail("rotating", "open", page);

  await expect(page.getByTestId("input-reg-email")).toBeVisible();
  await expect(page.getByTestId("button-send-code")).toBeVisible();
  await expect(page.getByTestId("input-partner-email")).toHaveCount(0);

  await expectImmediatelyAfter(
    page.getByTestId("card-event-info"),
    page.getByTestId("card-registration"),
    page.getByTestId("control-cancel-registration"),
  );
  await expectImmediatelyAfter(
    page.getByTestId("card-registration"),
    page.getByTestId("control-cancel-registration"),
    page.getByTestId("card-event-description"),
  );

  await expect(page.getByTestId("card-event-guidelines")).toBeVisible();
  await expect(page.getByTestId("notice-registration-closed")).toHaveCount(0);
  await expect(page.getByTestId("notice-event-cancelled")).toHaveCount(0);
});

test("open fixed-partner registration keeps its partner control above event copy", async ({
  page,
}) => {
  await openEventDetail("fixed_partner", "open", page);

  await expect(page.getByTestId("input-reg-email")).toBeVisible();
  await expect(page.getByTestId("input-partner-email")).toBeVisible();
  await expect(page.getByTestId("button-send-code")).toBeVisible();
  await expect(page.getByText("Teams:")).toBeVisible();

  await expectImmediatelyAfter(
    page.getByTestId("card-event-info"),
    page.getByTestId("card-registration"),
    page.getByTestId("control-cancel-registration"),
  );
  await expectImmediatelyAfter(
    page.getByTestId("card-registration"),
    page.getByTestId("control-cancel-registration"),
    page.getByTestId("card-event-description"),
  );
});

test("closed registration notice and cancellation control follow Event Info", async ({
  page,
}) => {
  await openEventDetail("rotating", "closed", page);

  await expect(page.getByTestId("card-registration")).toHaveCount(0);
  await expect(page.getByTestId("notice-registration-closed")).toContainText(
    "Registration is closed",
  );
  await expect(page.getByTestId("button-show-cancel")).toBeVisible();

  await expectImmediatelyAfter(
    page.getByTestId("card-event-info"),
    page.getByTestId("notice-registration-closed"),
    page.getByTestId("control-cancel-registration"),
  );
  await expectImmediatelyAfter(
    page.getByTestId("notice-registration-closed"),
    page.getByTestId("control-cancel-registration"),
    page.getByTestId("card-event-description"),
  );
});

test("cancelled fixed-partner event keeps cancellation control ahead of event copy", async ({
  page,
}) => {
  await openEventDetail("fixed_partner", "cancelled", page);

  await expect(page.getByTestId("card-registration")).toHaveCount(0);
  await expect(page.getByTestId("notice-registration-closed")).toHaveCount(0);
  await expect(page.getByTestId("button-show-cancel")).toBeVisible();
  await expect(page.getByTestId("notice-event-cancelled")).toContainText(
    "This event has been canceled.",
  );

  await expectImmediatelyAfter(
    page.getByTestId("card-event-info"),
    page.getByTestId("control-cancel-registration"),
    page.getByTestId("card-event-description"),
  );
  await expect(page.getByTestId("notice-event-cancelled")).toBeVisible();
});
