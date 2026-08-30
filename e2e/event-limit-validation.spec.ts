import { expect, test, type Page } from "@playwright/test";
import { mockFixedPartnerAdminApi } from "./fixtures/fixed-partner";
import { mockRotatingPartnerAdminApi } from "./fixtures/rotating-partner";

type EventFormat = "rotating" | "fixed_partner";

const FORMAT_CASES: Array<{
  format: EventFormat;
  label: string;
  limitError: string;
}> = [
  {
    format: "rotating",
    label: "rotating-partner",
    limitError: "Minimum participants cannot exceed maximum participants.",
  },
  {
    format: "fixed_partner",
    label: "fixed-partner",
    limitError: "Minimum teams cannot exceed maximum teams.",
  },
];

function collectMutationRequests(page: Page, format: EventFormat) {
  const requests: Array<{
    method: string;
    payload: Record<string, unknown>;
  }> = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname.startsWith(`/api/events/${format}`) &&
      ["POST", "PATCH"].includes(request.method())
    ) {
      requests.push({
        method: request.method(),
        payload: JSON.parse(request.postData() ?? "{}"),
      });
    }
  });
  return requests;
}

async function mockCreateEventApi(page: Page, format: EventFormat) {
  const event = {
    id: 1,
    name: "Created limit fixture",
    description: "<p>Test guidelines</p>",
    eventDescription: null,
    startDatetime: "2099-06-12T18:00:00.000Z",
    endDatetime: "2099-06-12T20:00:00.000Z",
    locationName: "Limit Test Courts",
    locationAddress: "100 Test Lane",
    teamFormat: format,
    ratingTypeRequired: "none",
    ratingConfig: null,
    minParticipants: format === "rotating" ? 4 : null,
    maxParticipants: format === "rotating" ? 16 : null,
    minTeams: format === "fixed_partner" ? 2 : null,
    maxTeams: format === "fixed_partner" ? 8 : null,
    waitlistEnabled: true,
    requireApproval: "none",
    signupStartDatetime: "2099-06-11T18:00:00.000Z",
    signupEndDatetime: "2099-06-12T17:00:00.000Z",
    showSignupEnd: true,
    status: "upcoming",
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === "/api/auth/me") {
      await route.fulfill({
        json: {
          id: 1,
          name: "Test Organizer",
          username: "organizer",
          role: "admin",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      });
      return;
    }

    if (pathname === `/api/events/${format}`) {
      if (request.method() === "POST") {
        await route.fulfill({ json: event });
      } else {
        await route.fulfill({ json: [] });
      }
      return;
    }

    if (pathname === `/api/event-defaults/${format}`) {
      await route.fulfill({
        json:
          format === "rotating"
            ? { minCapacity: 4, maxCapacity: 16 }
            : { minCapacity: 2, maxCapacity: 8 },
      });
      return;
    }

    if (pathname === "/api/settings") {
      await route.fulfill({
        json: {
          defaultTimezone: "America/New_York",
          defaultEventDurationHours: 2,
          guidelinesAndRules: "<p>Test guidelines</p>",
          defaultEventNames: [],
          defaultLocations: [],
          eventContactEmails: [],
          ratingRequirementsConfig: {
            dupr: {
              enabled: true,
              minAllowed: 2,
              maxAllowed: 8,
              defaultMin: 2,
              defaultMax: 4,
              defaultNrAllowed: false,
            },
            selfNumeric: {
              enabled: true,
              minAllowed: 2,
              maxAllowed: 6,
              defaultMin: 2,
              defaultMax: 4,
            },
            selfSkill: {
              enabled: true,
              levels: [],
              defaultMinLevel: 1,
              defaultMaxLevel: 3,
            },
          },
        },
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unexpected mocked path: ${pathname}` },
    });
  });
}

async function fillRequiredCreateFields(page: Page) {
  await page.getByTestId("input-event-name").fill("Limit validation fixture");
  await page.getByTestId("input-event-location-name").fill("Limit Test Courts");
  await page.getByTestId("input-event-location-address").fill("100 Test Lane");

  await page.getByTestId("input-event-start").click();
  await page.locator("button[data-day]").first().click();
  await page.locator('input[type="time"]').first().fill("18:00");
  await expect(page.getByTestId("input-event-start")).not.toHaveText(
    "Pick a date",
  );
}

for (const { format, label, limitError } of FORMAT_CASES) {
  test(`${label} create form blocks inverted limits and submits valid limits`, async ({
    page,
  }) => {
    await mockCreateEventApi(page, format);
    const mutationRequests = collectMutationRequests(page, format);
    await page.goto(
      `/admin/events/${format === "rotating" ? "rotating" : "fixed_partner"}/new`,
    );

    await expect(
      page.getByRole("heading", { name: "Create New Event" }),
    ).toBeVisible();
    await fillRequiredCreateFields(page);

    await page.getByTestId("input-min-participants").fill("20");
    await page.getByTestId("input-max-participants").fill("10");
    await expect(page.getByTestId("event-limit-error")).toHaveText(limitError);

    await page.getByTestId("button-submit-event").click();
    await expect.poll(() => mutationRequests.length).toBe(0);

    await page.getByTestId("input-max-participants").fill("24");
    await expect(page.getByTestId("event-limit-error")).toBeHidden();
    await page.getByTestId("button-submit-event").click();

    await expect.poll(() => mutationRequests.length).toBe(1);
    expect(mutationRequests[0]).toMatchObject({
      method: "POST",
      payload:
        format === "rotating"
          ? { minParticipants: 20, maxParticipants: 24 }
          : { minTeams: 20, maxTeams: 24 },
    });
  });
}

for (const { format, label, limitError } of FORMAT_CASES) {
  test(`${label} edit form blocks inverted limits and submits valid limits`, async ({
    page,
  }) => {
    if (format === "rotating") {
      await mockRotatingPartnerAdminApi(page);
    } else {
      await mockFixedPartnerAdminApi(page);
    }

    const mutationRequests = collectMutationRequests(page, format);
    await page.goto(`/admin/events/${format}/1`);
    await expect(page.getByTestId("button-edit-event")).toBeVisible();
    await page.getByTestId("button-edit-event").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("input-edit-min-participants").fill("20");
    await dialog.getByTestId("input-edit-max-participants").fill("10");
    await expect(dialog.getByTestId("event-limit-error")).toHaveText(
      limitError,
    );

    await page.getByTestId("button-submit-edit-event").click();
    await expect.poll(() => mutationRequests.length).toBe(0);

    await dialog.getByTestId("input-edit-max-participants").fill("24");
    await expect(dialog.getByTestId("event-limit-error")).toBeHidden();
    await page.getByTestId("button-submit-edit-event").click();

    await expect.poll(() => mutationRequests.length).toBe(1);
    expect(mutationRequests[0]).toMatchObject({
      method: "PATCH",
      payload:
        format === "rotating"
          ? { minParticipants: 20, maxParticipants: 24 }
          : { minTeams: 20, maxTeams: 24 },
    });
  });
}
