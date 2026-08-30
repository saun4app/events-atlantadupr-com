import type { Page } from "@playwright/test";

const FIXED_PARTNER_EVENT = {
  id: 1,
  seriesId: null,
  name: "Fixed Partner organizer fixture",
  eventDescription: "<p>Organizer fixture event details.</p>",
  description: "<p>Organizer fixture guidelines.</p>",
  startDatetime: "2099-06-12T18:00:00.000Z",
  endDatetime: "2099-06-12T20:00:00.000Z",
  locationName: "Organizer Fixture Courts",
  locationAddress: "100 Test Lane",
  teamFormat: "fixed_partner",
  ratingTypeRequired: "none",
  ratingConfig: null,
  minParticipants: 4,
  maxParticipants: 16,
  minTeams: 2,
  maxTeams: 8,
  waitlistEnabled: true,
  requireApproval: "none",
  signupStartDatetime: "2020-01-01T12:00:00.000Z",
  signupEndDatetime: "2099-01-01T12:00:00.000Z",
  showSignupEnd: true,
  status: "upcoming",
  courtFeeEnabled: false,
  memberFee: 0,
  nonMemberFee: 0,
  contactEmail: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

export async function mockFixedPartnerAdminApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;

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

    if (pathname === "/api/events/fixed_partner/1") {
      await route.fulfill({ json: FIXED_PARTNER_EVENT });
      return;
    }

    if (pathname === "/api/events/fixed_partner/1/registrations") {
      await route.fulfill({ json: [] });
      return;
    }

    if (pathname === "/api/settings") {
      await route.fulfill({
        json: {
          defaultTimezone: "America/New_York",
          defaultEventDurationHours: 2,
          guidelinesAndRules: "<p>Organizer fixture guidelines.</p>",
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
