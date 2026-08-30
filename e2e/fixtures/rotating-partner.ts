import type { Page } from "@playwright/test";

const ROTATING_PARTNER_EVENT = {
  id: 1,
  seriesId: null,
  name: "Rotating Partner organizer fixture",
  eventDescription: "<p>Organizer fixture event details.</p>",
  description: "<p>Organizer fixture guidelines.</p>",
  startDatetime: "2099-06-12T18:00:00.000Z",
  endDatetime: "2099-06-12T20:00:00.000Z",
  locationName: "Organizer Fixture Courts",
  locationAddress: "100 Test Lane",
  teamFormat: "rotating",
  ratingTypeRequired: "dupr",
  ratingConfig: {
    min: 2,
    max: 4,
    nrAllowed: false,
  },
  minParticipants: 4,
  maxParticipants: 16,
  minTeams: null,
  maxTeams: null,
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

type RotatingPartnerFixtureOptions = {
  ratingTypeRequired?: "dupr" | "self_numeric" | "self_skill";
  ratingConfig?: Record<string, number | boolean>;
  selfSkillLevels?: Array<{ text: string; level: number }>;
};

export async function mockRotatingPartnerAdminApi(
  page: Page,
  options: RotatingPartnerFixtureOptions = {},
) {
  const initialEvent = {
    ...ROTATING_PARTNER_EVENT,
    ...(options.ratingTypeRequired
      ? { ratingTypeRequired: options.ratingTypeRequired }
      : {}),
    ratingConfig: options.ratingConfig
      ? { ...options.ratingConfig }
      : { ...ROTATING_PARTNER_EVENT.ratingConfig },
  };
  const selfSkillLevels = options.selfSkillLevels ?? [
    { text: "Beginner", level: 1 },
    { text: "Intermediate", level: 2 },
    { text: "Advanced", level: 3 },
  ];
  let currentEvent = {
    ...initialEvent,
    ratingConfig: { ...initialEvent.ratingConfig },
  };

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

    if (pathname === "/api/events/rotating/1") {
      if (route.request().method() === "PATCH") {
        const updates = JSON.parse(route.request().postData() ?? "{}");
        currentEvent = {
          ...currentEvent,
          ...updates,
          ...(updates.ratingConfig
            ? { ratingConfig: { ...updates.ratingConfig } }
            : {}),
        };
      }
      await route.fulfill({ json: currentEvent });
      return;
    }

    if (pathname === "/api/events/rotating/1/registrations") {
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
              levels: selfSkillLevels,
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