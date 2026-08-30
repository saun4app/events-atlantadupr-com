import type { Page } from "@playwright/test";

export type CloneEventFormat = "rotating" | "fixed_partner";

const EVENTS = [
  {
    id: 1,
    name: "Older Smash",
    startDatetime: "2026-08-01T18:00:00.000Z",
    description: "<p>Test guidelines</p>",
    eventDescription: "<p>Older event details</p>",
    locationName: "Test Courts",
    locationAddress: "100 Test Lane",
    ratingTypeRequired: "none",
    waitlistEnabled: true,
    minParticipants: 4,
    maxParticipants: 16,
    minTeams: 2,
    maxTeams: 8,
    requireApproval: "none",
  },
  {
    id: 2,
    name: "Newest Smash",
    startDatetime: "2026-08-20T18:00:00.000Z",
    description: "<p>Test guidelines</p>",
    eventDescription: "<p>Newest event details</p>",
    locationName: "Test Courts",
    locationAddress: "100 Test Lane",
    ratingTypeRequired: "none",
    waitlistEnabled: true,
    minParticipants: 20,
    maxParticipants: 10,
    minTeams: 20,
    maxTeams: 10,
    requireApproval: "none",
  },
  {
    id: 3,
    name: "Court Rally",
    startDatetime: "2026-08-10T18:00:00.000Z",
    description: "<p>Test guidelines</p>",
    eventDescription: "<p>Court event details</p>",
    locationName: "Test Courts",
    locationAddress: "100 Test Lane",
    ratingTypeRequired: "none",
    waitlistEnabled: true,
    minParticipants: 4,
    maxParticipants: 16,
    minTeams: 2,
    maxTeams: 8,
    requireApproval: "none",
  },
];

export async function mockCloneEventApi(
  page: Page,
  eventType: CloneEventFormat,
) {
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

    if (pathname === `/api/events/${eventType}`) {
      if (route.request().method() === "POST") {
        await route.fulfill({
          json: {
            ...EVENTS[1],
            id: 4,
            name: "Newest Smash (Copy)",
          },
        });
      } else {
        await route.fulfill({ json: EVENTS });
      }
      return;
    }

    if (pathname === `/api/event-defaults/${eventType}`) {
      await route.fulfill({ json: { minCapacity: 4, maxCapacity: 16 } });
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