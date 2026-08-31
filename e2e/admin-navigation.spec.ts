import { expect, test, type Page } from "@playwright/test";

type AdminRole = "admin" | "event_organizer";

const ADMIN_USER = {
  id: 1,
  name: "Test Admin",
  username: "admin",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const SETTINGS = {
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
};

const ROTATING_EVENT = {
  id: 101,
  seriesId: null,
  name: "Rotating Partner admin fixture",
  eventDescription: "<p>Rotating event details.</p>",
  description: "<p>Rotating event guidelines.</p>",
  startDatetime: "2099-06-12T18:00:00.000Z",
  endDatetime: "2099-06-12T20:00:00.000Z",
  locationName: "Admin Fixture Courts",
  locationAddress: "100 Test Lane",
  teamFormat: "rotating",
  ratingTypeRequired: "none",
  ratingConfig: null,
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

const FIXED_PARTNER_EVENT = {
  ...ROTATING_EVENT,
  id: 202,
  name: "Fixed Partner admin fixture",
  teamFormat: "fixed_partner",
  minTeams: 2,
  maxTeams: 8,
};

async function mockAdminNavigationApi(page: Page, role: AdminRole) {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (pathname === "/api/auth/me") {
      await route.fulfill({
        json: {
          ...ADMIN_USER,
          role,
        },
      });
      return;
    }

    if (
      pathname === "/api/events/rotating" ||
      pathname === "/api/events/fixed_partner"
    ) {
      await route.fulfill({ json: [] });
      return;
    }

    if (pathname === `/api/events/rotating/${ROTATING_EVENT.id}`) {
      await route.fulfill({ json: ROTATING_EVENT });
      return;
    }

    if (pathname === `/api/events/fixed_partner/${FIXED_PARTNER_EVENT.id}`) {
      await route.fulfill({ json: FIXED_PARTNER_EVENT });
      return;
    }

    if (
      pathname ===
        `/api/events/rotating/${ROTATING_EVENT.id}/registrations` ||
      pathname ===
        `/api/events/fixed_partner/${FIXED_PARTNER_EVENT.id}/registrations`
    ) {
      await route.fulfill({ json: [] });
      return;
    }

    if (
      pathname === "/api/event-defaults/rotating" ||
      pathname === "/api/event-defaults/fixed_partner"
    ) {
      await route.fulfill({ json: { minCapacity: 4, maxCapacity: 16 } });
      return;
    }

    if (pathname === "/api/diagnostics/email-failures") {
      await route.fulfill({ json: { count: 0, failures: [] } });
      return;
    }

    if (pathname === "/api/settings") {
      await route.fulfill({ json: SETTINGS });
      return;
    }

    if (pathname === "/api/members" || pathname === "/api/users") {
      await route.fulfill({ json: [] });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unexpected mocked path: ${pathname}` },
    });
  });
}

function parentLink(page: Page, testId: string) {
  return page.getByTestId(testId).locator("xpath=..");
}

async function expectAdminNavigation(
  page: Page,
  activeTestId: string,
  activeHref: string,
) {
  const items = [
    ["nav-manage-events", "Manage Events", "/admin/events/rotating"],
    ["nav-manage-members", "Manage Members", "/admin/members"],
    ["nav-manage-users", "Manage Users", "/admin/users"],
    ["nav-settings", "Settings", "/admin/settings"],
  ] as const;

  for (const [testId, label, href] of items) {
    const item = page.getByTestId(testId);
    await expect(item).toHaveText(label);
    await expect(parentLink(page, testId)).toHaveAttribute("href", href);
    await expect(item).toHaveClass(
      activeTestId === testId ? /bg-primary/ : /^((?!bg-primary).)*$/,
    );
  }

  expect(activeHref).toBeTruthy();
}

async function expectEventsNavigation(
  page: Page,
  eventType: "rotating" | "fixed_partner",
  activeTestId: string,
) {
  const items = [
    [
      "events-nav-rotating",
      "Rotating Partners",
      "/admin/events/rotating",
    ],
    ["events-nav-fixed_partner", "Fixed-Partner", "/admin/events/fixed_partner"],
    [
      "events-nav-new-event",
      "New Event",
      `/admin/events/${eventType}/new`,
    ],
  ] as const;

  for (const [testId, label, href] of items) {
    const item = page.getByTestId(testId);
    await expect(item).toHaveText(label);
    await expect(parentLink(page, testId)).toHaveAttribute("href", href);
    await expect(item).toHaveClass(
      activeTestId === testId ? /bg-primary/ : /^((?!bg-primary).)*$/,
    );
  }
}

test("admin can navigate every admin area and event format", async (
  { page },
  testInfo,
) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The desktop navigation is covered by the desktop browser project",
  );

  await mockAdminNavigationApi(page, "admin");
  await page.goto("/admin/events/rotating");

  await expect(
    page.getByRole("heading", { name: "Manage Events — Rotating Partners" }),
  ).toBeVisible();
  await expectAdminNavigation(
    page,
    "nav-manage-events",
    "/admin/events/rotating",
  );
  await expectEventsNavigation(page, "rotating", "events-nav-rotating");

  await page.getByTestId("events-nav-fixed_partner").click();
  await expect(page).toHaveURL(/\/admin\/events\/fixed_partner$/);
  await expect(
    page.getByRole("heading", { name: "Manage Events — Fixed-Partner" }),
  ).toBeVisible();
  await expectAdminNavigation(
    page,
    "nav-manage-events",
    "/admin/events/fixed_partner",
  );
  await expectEventsNavigation(page, "fixed_partner", "events-nav-fixed_partner");

  await page.getByTestId("events-nav-new-event").click();
  await expect(page).toHaveURL(/\/admin\/events\/fixed_partner\/new$/);
  await expect(
    page.getByRole("heading", { name: "Create New Event" }),
  ).toBeVisible();
  await expectAdminNavigation(
    page,
    "nav-manage-events",
    "/admin/events/rotating",
  );
  await expectEventsNavigation(page, "fixed_partner", "events-nav-new-event");

  await page.getByTestId("nav-manage-members").click();
  await expect(page).toHaveURL(/\/admin\/members$/);
  await expect(
    page.getByRole("heading", { name: "Manage Members" }),
  ).toBeVisible();
  await expectAdminNavigation(
    page,
    "nav-manage-members",
    "/admin/members",
  );

  await page.getByTestId("nav-manage-users").click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(
    page.getByRole("heading", { name: "Manage Users" }),
  ).toBeVisible();
  await expectAdminNavigation(page, "nav-manage-users", "/admin/users");

  await page.getByTestId("nav-settings").click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(page.getByRole("heading", { name: "App Settings" })).toBeVisible();
  await expectAdminNavigation(page, "nav-settings", "/admin/settings");
});

test("admin pages keep their route and active navigation after refresh", async (
  { page },
  testInfo,
) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The desktop refresh coverage is covered by the desktop browser project",
  );

  await mockAdminNavigationApi(page, "admin");

  const routes = [
    {
      path: "/admin/events/rotating",
      heading: "Manage Events — Rotating Partners",
      adminNav: ["nav-manage-events", "/admin/events/rotating"] as const,
      eventNav: ["rotating", "events-nav-rotating"] as const,
    },
    {
      path: "/admin/events/fixed_partner",
      heading: "Manage Events — Fixed-Partner",
      adminNav: ["nav-manage-events", "/admin/events/fixed_partner"] as const,
      eventNav: ["fixed_partner", "events-nav-fixed_partner"] as const,
    },
    {
      path: `/admin/events/rotating/${ROTATING_EVENT.id}`,
      heading: ROTATING_EVENT.name,
      adminNav: ["nav-manage-events", "/admin/events/rotating"] as const,
    },
    {
      path: `/admin/events/fixed_partner/${FIXED_PARTNER_EVENT.id}`,
      heading: FIXED_PARTNER_EVENT.name,
      adminNav: ["nav-manage-events", "/admin/events/rotating"] as const,
    },
    {
      path: "/admin/events/rotating/new",
      heading: "Create New Event",
      adminNav: ["nav-manage-events", "/admin/events/rotating"] as const,
      eventNav: ["rotating", "events-nav-new-event"] as const,
    },
    {
      path: "/admin/events/fixed_partner/new",
      heading: "Create New Event",
      adminNav: ["nav-manage-events", "/admin/events/rotating"] as const,
      eventNav: ["fixed_partner", "events-nav-new-event"] as const,
    },
    {
      path: "/admin/members",
      heading: "Manage Members",
      adminNav: ["nav-manage-members", "/admin/members"] as const,
    },
    {
      path: "/admin/users",
      heading: "Manage Users",
      adminNav: ["nav-manage-users", "/admin/users"] as const,
    },
    {
      path: "/admin/settings",
      heading: "App Settings",
      adminNav: ["nav-settings", "/admin/settings"] as const,
    },
  ] as const;

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page).toHaveURL(new RegExp(`${route.path}$`));
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(new RegExp(`${route.path}$`));
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
    await expectAdminNavigation(page, route.adminNav[0], route.adminNav[1]);

    if ("eventNav" in route) {
      await expectEventsNavigation(page, route.eventNav[0], route.eventNav[1]);
    }
  }
});

test("event organizers see event navigation but not admin-only areas", async ({
  page,
}) => {
  await mockAdminNavigationApi(page, "event_organizer");
  await page.goto("/admin/events/rotating");

  await expect(
    page.getByRole("heading", { name: "Manage Events — Rotating Partners" }),
  ).toBeVisible();
  await expect(page.getByTestId("nav-manage-events")).toHaveText("Manage Events");
  await expect(
    parentLink(page, "nav-manage-events"),
  ).toHaveAttribute("href", "/admin/events/rotating");
  await expect(page.getByTestId("nav-manage-events")).toHaveClass(/bg-primary/);
  await expectEventsNavigation(page, "rotating", "events-nav-rotating");

  await expect(page.getByTestId("nav-manage-members")).toHaveCount(0);
  await expect(page.getByTestId("nav-manage-users")).toHaveCount(0);
  await expect(page.getByTestId("nav-settings")).toHaveCount(0);
});

test("mobile admin menu closes after selecting a navigation link", async (
  { page },
  testInfo,
) => {
  test.skip(
    testInfo.project.name !== "mobile-chromium",
    "This behavior is covered by the mobile browser project",
  );

  await mockAdminNavigationApi(page, "admin");
  await page.goto("/admin/events/rotating");

  const menuButton = page.getByRole("button", { name: "Toggle menu" });
  await expect(menuButton).toBeVisible();
  await menuButton.click();

  await expect(page.getByTestId("nav-mobile-manage-events")).toBeVisible();
  await expect(page.getByTestId("nav-mobile-manage-members")).toBeVisible();
  await expect(page.getByTestId("nav-mobile-manage-users")).toBeVisible();
  await expect(page.getByTestId("nav-mobile-settings")).toBeVisible();

  await page.getByTestId("nav-mobile-manage-members").click();
  await expect(page).toHaveURL(/\/admin\/members$/);
  await expect(
    page.getByRole("heading", { name: "Manage Members" }),
  ).toBeVisible();
  await expect(page.getByTestId("nav-mobile-manage-members")).toHaveCount(0);
});