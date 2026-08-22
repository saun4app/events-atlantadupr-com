import type { Page } from "@playwright/test";

export type EventDetailState = "open" | "closed" | "cancelled";
export type EventFormat = "rotating" | "fixed_partner";
type MockEventDetailOptions = {
  requireApproval?: "none" | "all" | "nr_only";
};

const OPEN_SIGNUP_START = "2020-01-01T12:00:00.000Z";
const OPEN_SIGNUP_END = "2099-01-01T12:00:00.000Z";

function makeEvent(
  format: EventFormat,
  state: EventDetailState,
  options: MockEventDetailOptions,
) {
  return {
    id: 1,
    seriesId: null,
    name: `${format === "fixed_partner" ? "Fixed Partner" : "Rotating Partner"} ${state} placement event`,
    eventDescription:
      "<p>Event details must stay below registration controls.</p>",
    description: "<p>Guidelines must stay below registration controls.</p>",
    startDatetime: "2099-06-12T18:00:00.000Z",
    endDatetime: "2099-06-12T20:00:00.000Z",
    locationName: "Placement Test Courts",
    locationAddress: "100 Test Lane",
    teamFormat: format,
    ratingTypeRequired: "none",
    ratingConfig: null,
    minParticipants: 4,
    maxParticipants: 16,
    minTeams: format === "fixed_partner" ? 2 : null,
    maxTeams: format === "fixed_partner" ? 8 : null,
    waitlistEnabled: true,
    requireApproval: options.requireApproval ?? "none",
    signupStartDatetime: OPEN_SIGNUP_START,
    signupEndDatetime: OPEN_SIGNUP_END,
    showSignupEnd: true,
    status: state === "open" ? "upcoming" : state,
    courtFeeEnabled: false,
    memberFee: 0,
    nonMemberFee: 0,
    contactEmail: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

export async function mockEventDetailApi(
  page: Page,
  format: EventFormat,
  state: EventDetailState,
  options: MockEventDetailOptions = {},
) {
  const event = makeEvent(format, state, options);
  const eventPath = `/api/events/${format}/1`;

  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (pathname === eventPath) {
      await route.fulfill({ json: event });
      return;
    }

    if (pathname === `${eventPath}/roster-summary`) {
      await route.fulfill({
        json:
          format === "fixed_partner"
            ? {
                confirmed: 0,
                waitlisted: 0,
                pendingApproval: 0,
                maxParticipants: 16,
                confirmedTeams: 0,
                maxTeams: 8,
              }
            : {
                confirmed: 0,
                waitlisted: 0,
                pendingApproval: 0,
                maxParticipants: 16,
              },
      });
      return;
    }

    if (pathname === `${eventPath}/registrations/request-code`) {
      await route.fulfill({ json: { sent: true, cooldownSeconds: 30 } });
      return;
    }

    if (pathname === `${eventPath}/registrations`) {
      await route.fulfill({
        json:
          route.request().method() === "POST"
            ? { id: 1, status: "pending_approval" }
            : [],
      });
      return;
    }

    if (pathname === "/api/settings") {
      await route.fulfill({
        json: { maintenanceMode: false, joinInstructions: "" },
      });
      return;
    }

    if (pathname === "/api/auth/me") {
      await route.fulfill({ status: 401, json: { error: "Unauthenticated" } });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unexpected mocked path: ${pathname}` },
    });
  });
}
