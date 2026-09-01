import { expect, test, type Page } from "@playwright/test";
import rawSiteNav from "../api-docs/site-nav.json";
import rawUserRolesConfig from "../app-config/user-roles.json";

const userRolesConfig = rawUserRolesConfig;
const ADMIN_ROLE = userRolesConfig.defaults.auditActorRole;
const EVENT_MANAGER_ROLE = userRolesConfig.defaults.newUserRole;
const PARTICIPANT_ROLE = userRolesConfig.defaults.databaseRole;

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

const ASSIGNABLE_STAFF = [
  {
    id: 11,
    name: "Captain Casey",
    username: "captain",
    role: "event_captain",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 12,
    name: "Leader Lee",
    username: "leader",
    role: "court_leader",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

async function mockAdminNavigationApi(
  page: Page,
  role: string,
  options: { canWriteEvent?: boolean } = {},
) {
  const canWriteEvent = options.canWriteEvent ?? true;
  const assignments = new Map<string, number[]>();
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
      await route.fulfill({ json: { ...ROTATING_EVENT, canWrite: canWriteEvent } });
      return;
    }

    if (pathname === `/api/events/fixed_partner/${FIXED_PARTNER_EVENT.id}`) {
      await route.fulfill({ json: { ...FIXED_PARTNER_EVENT, canWrite: canWriteEvent } });
      return;
    }

    if (
      pathname === `/api/events/rotating/${ROTATING_EVENT.id}/registrations` ||
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

    if (pathname === "/api/users/assignable-staff") {
      await route.fulfill({ json: ASSIGNABLE_STAFF });
      return;
    }

    const assignmentMatch = pathname.match(
      /^\/api\/events\/(rotating|fixed_partner)\/(\d+)\/assignments(?:\/(\d+))?$/,
    );
    if (assignmentMatch) {
      const [, eventType, eventId, userId] = assignmentMatch;
      const assignmentKey = `${eventType}/${eventId}`;
      const assignedIds = assignments.get(assignmentKey) ?? [];

      if (route.request().method() === "GET") {
        await route.fulfill({
          json: assignedIds.flatMap((assignedId) => {
            const staff = ASSIGNABLE_STAFF.find((user) => user.id === assignedId);
            return staff
              ? [{
                  userId: staff.id,
                  eventId: Number(eventId),
                  eventType,
                  assignedAt: "2026-01-01T00:00:00.000Z",
                  userName: staff.name,
                  userUsername: staff.username,
                  userRole: staff.role,
                }]
              : [];
          }),
        });
        return;
      }

      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { userId?: number };
        if (body.userId && !assignedIds.includes(Number(body.userId))) {
          assignedIds.push(Number(body.userId));
          assignments.set(assignmentKey, assignedIds);
        }
        const staff = ASSIGNABLE_STAFF.find((user) => user.id === Number(body.userId));
        await route.fulfill({
          status: 201,
          json: {
            userId: Number(body.userId),
            eventId: Number(eventId),
            eventType,
            userName: staff?.name,
            userUsername: staff?.username,
            userRole: staff?.role,
          },
        });
        return;
      }

      if (route.request().method() === "DELETE" && userId) {
        assignments.set(
          assignmentKey,
          assignedIds.filter((assignedId) => assignedId !== Number(userId)),
        );
        await route.fulfill({ status: 204, body: "" });
        return;
      }
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
  role: string,
  activeTestId: string,
) {
  const items = rawSiteNav.items;
  const visibleItems = items.filter((item) =>
    userRolesConfig.groups[item.roleGroup].includes(role),
  );

  for (const itemConfig of visibleItems) {
    const testId = `nav-${itemConfig.testId}`;
    const item = page.getByTestId(testId);
    await expect(item).toHaveText(itemConfig.label);
    await expect(parentLink(page, testId)).toHaveAttribute(
      "href",
      itemConfig.href,
    );
    await expect(item).toHaveClass(
      activeTestId === testId ? /bg-primary/ : /^((?!bg-primary).)*$/,
    );
  }

  for (const itemConfig of items.filter(
    (item) => !visibleItems.includes(item),
  )) {
    await expect(page.getByTestId(`nav-${itemConfig.testId}`)).toHaveCount(0);
  }
}

async function expectEventsNavigation(
  page: Page,
  eventType: "rotating" | "fixed_partner",
  activeTestId: string,
) {
  const eventsItem = rawSiteNav.items.find((item) => item.children);
  const items = eventsItem?.children ?? [];

  for (const itemConfig of items) {
    const href =
      itemConfig.href ??
      itemConfig.hrefTemplate?.replace("{eventType}", eventType);
    const testId = `events-nav-${itemConfig.testId}`;
    const item = page.getByTestId(testId);
    await expect(item).toHaveText(itemConfig.label);
    await expect(parentLink(page, testId)).toHaveAttribute("href", href);
    await expect(item).toHaveClass(
      activeTestId === testId ? /bg-primary/ : /^((?!bg-primary).)*$/,
    );
  }
}

for (const staffRole of userRolesConfig.groups.assignableStaff) {
  const roleLabel =
    userRolesConfig.roles.find((role) => role.id === staffRole)?.label ??
    staffRole;

  test(`${roleLabel} keeps configured event-management access`, async ({
    page,
  }) => {
    const canAccessAdminPanel =
      userRolesConfig.groups.adminPanel.includes(staffRole);
    const canWriteEvents =
      userRolesConfig.groups.eventWriters.includes(staffRole);

    expect(canAccessAdminPanel).toBe(true);
    expect(canWriteEvents).toBe(true);

    await mockAdminNavigationApi(page, staffRole);
    await page.goto("/admin/events/rotating");

    await expect(
      page.getByRole("heading", { name: "Manage Events — Rotating Partners" }),
    ).toBeVisible();
    await expectAdminNavigation(page, staffRole, "nav-manage-events");
    await expectEventsNavigation(page, "rotating", "events-nav-rotating");
    await expect(page.getByTestId("button-event-setup")).toHaveCount(
      canWriteEvents ? 1 : 0,
    );

    await page.goto(`/admin/events/rotating/${ROTATING_EVENT.id}`);
    await expect(
      page.getByRole("heading", { name: ROTATING_EVENT.name }),
    ).toBeVisible();
    await expect(page.getByTestId("button-edit-event")).toHaveCount(
      canWriteEvents ? 1 : 0,
    );
     await expect(page.getByTestId("panel-event-assignments")).toHaveCount(0);

    if (canWriteEvents) {
      await page.getByTestId("button-edit-event").click();
      await expect(page.getByTestId("button-submit-edit-event")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Delete Event", exact: true }),
      ).toHaveCount(
        userRolesConfig.groups.adminOnly.includes(staffRole) ? 1 : 0,
      );
    }
  });
}

for (const staffRole of userRolesConfig.groups.assignableStaff) {
  const roleLabel =
    userRolesConfig.roles.find((role) => role.id === staffRole)?.label ??
    staffRole;

  test(`${roleLabel} cannot use controls for an unassigned event`, async ({ page }) => {
    await mockAdminNavigationApi(page, staffRole, { canWriteEvent: false });
    await page.goto(`/admin/events/rotating/${ROTATING_EVENT.id}`);

    await expect(
      page.getByRole("heading", { name: ROTATING_EVENT.name }),
    ).toBeVisible();
    await expect(page.getByTestId("button-edit-event")).toHaveCount(0);
    await expect(page.getByTestId("input-add-emails")).toHaveCount(0);
    await expect(page.getByTestId("button-add-participant")).toHaveCount(0);
  });
}

test("admin can navigate every admin area and event format", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The desktop navigation is covered by the desktop browser project",
  );

  await mockAdminNavigationApi(page, ADMIN_ROLE);
  await page.goto("/admin/events/rotating");

  await expect(
    page.getByRole("heading", { name: "Manage Events — Rotating Partners" }),
  ).toBeVisible();
  await expectAdminNavigation(page, ADMIN_ROLE, "nav-manage-events");
  await expectEventsNavigation(page, "rotating", "events-nav-rotating");

  await page.getByTestId("events-nav-fixed_partner").click();
  await expect(page).toHaveURL(/\/admin\/events\/fixed_partner$/);
  await expect(
    page.getByRole("heading", { name: "Manage Events — Fixed-Partner" }),
  ).toBeVisible();
  await expectAdminNavigation(page, ADMIN_ROLE, "nav-manage-events");
  await expectEventsNavigation(
    page,
    "fixed_partner",
    "events-nav-fixed_partner",
  );

  await page.getByTestId("events-nav-new-event").click();
  await expect(page).toHaveURL(/\/admin\/events\/fixed_partner\/new$/);
  await expect(
    page.getByRole("heading", { name: "Create New Event" }),
  ).toBeVisible();
  await expectAdminNavigation(page, ADMIN_ROLE, "nav-manage-events");
  await expectEventsNavigation(page, "fixed_partner", "events-nav-new-event");

  await page.getByTestId("nav-manage-members").click();
  await expect(page).toHaveURL(/\/admin\/members$/);
  await expect(
    page.getByRole("heading", { name: "Manage Members" }),
  ).toBeVisible();
  await expectAdminNavigation(page, ADMIN_ROLE, "nav-manage-members");

  await page.getByTestId("nav-manage-users").click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(
    page.getByRole("heading", { name: "Manage Users" }),
  ).toBeVisible();
  await expectAdminNavigation(page, ADMIN_ROLE, "nav-manage-users");

  await page.getByTestId("nav-settings").click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  await expect(
    page.getByRole("heading", { name: "App Settings" }),
  ).toBeVisible();
  await expectAdminNavigation(page, ADMIN_ROLE, "nav-settings");

  await page.goto(`/admin/events/rotating/${ROTATING_EVENT.id}`);
  await expect(
    page.getByRole("heading", { name: ROTATING_EVENT.name }),
  ).toBeVisible();
  await expect(page.getByTestId("button-edit-event")).toBeVisible();
  await page.getByTestId("button-edit-event").click();
  await expect(page.getByTestId("button-submit-edit-event")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete Event", exact: true }),
  ).toBeVisible();
});

test("admin pages keep their route and active navigation after refresh", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The desktop refresh coverage is covered by the desktop browser project",
  );

  await mockAdminNavigationApi(page, ADMIN_ROLE);

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
    await expect(
      page.getByRole("heading", { name: route.heading }),
    ).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(new RegExp(`${route.path}$`));
    await expect(
      page.getByRole("heading", { name: route.heading }),
    ).toBeVisible();
    await expectAdminNavigation(page, ADMIN_ROLE, route.adminNav[0]);

    if ("eventNav" in route) {
      await expectEventsNavigation(page, route.eventNav[0], route.eventNav[1]);
    }
  }
});

test("event organizers see event navigation but not admin-only areas", async ({
  page,
}) => {
  await mockAdminNavigationApi(page, EVENT_MANAGER_ROLE);
  await page.goto("/admin/events/rotating");

  await expect(
    page.getByRole("heading", { name: "Manage Events — Rotating Partners" }),
  ).toBeVisible();
  await expectAdminNavigation(page, EVENT_MANAGER_ROLE, "nav-manage-events");
  await expectEventsNavigation(page, "rotating", "events-nav-rotating");

  await expect(page.getByTestId("button-event-setup")).toBeVisible();

  await page.goto(`/admin/events/rotating/${ROTATING_EVENT.id}`);
  await expect(
    page.getByRole("heading", { name: ROTATING_EVENT.name }),
  ).toBeVisible();
  await expect(page.getByTestId("button-edit-event")).toBeVisible();
  await page.getByTestId("button-edit-event").click();
  await expect(page.getByTestId("button-submit-edit-event")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete Event", exact: true }),
  ).toHaveCount(
    userRolesConfig.groups.adminOnly.includes(EVENT_MANAGER_ROLE) ? 1 : 0,
  );
});

test("event organizers can manage separate rotating and fixed-partner assignments", async ({
  page,
}) => {
  await mockAdminNavigationApi(page, EVENT_MANAGER_ROLE);

  await page.goto(`/admin/events/rotating/${ROTATING_EVENT.id}`);
  await expect(page.getByTestId("panel-event-assignments")).toBeVisible();
  await page.getByTestId("select-assignment-staff").selectOption("11");
  await page.getByTestId("button-assign-staff").click();
  await expect(page.getByTestId("assignment-row-11")).toContainText(
    "Captain Casey",
  );

  await page.goto(`/admin/events/fixed_partner/${FIXED_PARTNER_EVENT.id}`);
  await expect(page.getByTestId("panel-event-assignments")).toBeVisible();
  await expect(page.getByTestId("assignment-row-11")).toHaveCount(0);
  await page.getByTestId("select-assignment-staff").selectOption("12");
  await page.getByTestId("button-assign-staff").click();
  await expect(page.getByTestId("assignment-row-12")).toContainText(
    "Leader Lee",
  );

  await page.getByTestId("button-remove-assignment-12").click();
  await expect(page.getByTestId("assignment-row-12")).toHaveCount(0);

  await page.goto(`/admin/events/rotating/${ROTATING_EVENT.id}`);
  await expect(page.getByTestId("assignment-row-11")).toContainText(
    "Captain Casey",
  );
});

test("participants cannot see or enter the configured admin areas", async ({
  page,
}) => {
  await mockAdminNavigationApi(page, PARTICIPANT_ROLE);
  await page.goto("/admin/events/rotating");

  await expect(page).toHaveURL(/\/$/);
  for (const itemConfig of rawSiteNav.items) {
    await expect(page.getByTestId(`nav-${itemConfig.testId}`)).toHaveCount(0);
  }
  await expect(page.getByTestId("button-event-setup")).toHaveCount(0);
  await expect(page.getByTestId("button-edit-event")).toHaveCount(0);
});

test("mobile admin menu closes after selecting a navigation link", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chromium",
    "This behavior is covered by the mobile browser project",
  );

  await mockAdminNavigationApi(page, ADMIN_ROLE);
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
