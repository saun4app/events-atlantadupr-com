import { expect, test, type Page } from "@playwright/test";

const PUBLIC_EVENT = {
  id: 901,
  seriesId: null,
  name: "Public visitor fixture",
  eventDescription: "<p>Public event details.</p>",
  description: "<p>Public event guidelines.</p>",
  startDatetime: "2099-06-12T18:00:00.000Z",
  endDatetime: "2099-06-12T20:00:00.000Z",
  locationName: "Visitor Fixture Courts",
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

const PUBLIC_FIXED_PARTNER_EVENT = {
  ...PUBLIC_EVENT,
  id: 902,
  name: "Public fixed-partner visitor fixture",
  eventDescription: "<p>Fixed-partner event details.</p>",
  description: "<p>Fixed-partner registration guidelines.</p>",
  teamFormat: "fixed_partner",
  minTeams: 2,
  maxTeams: 8,
};

type ApiRequest = {
  method: string;
  pathname: string;
  headers: Record<string, string>;
};

async function mockAnonymousVisitorApi(
  page: Page,
  options: { fixedPartnerEventsFailure?: boolean | "once" } = {},
) {
  const requests: ApiRequest[] = [];
  let fixedPartnerEventsRequestCount = 0;

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      requests.push({
        method: request.method(),
        pathname: url.pathname,
        headers: request.headers(),
      });
    }
  });

  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (pathname === "/api/auth/me") {
      await route.fulfill({
        status: 401,
        json: { error: "Not authenticated" },
      });
      return;
    }

    if (pathname === "/api/events/rotating") {
      await route.fulfill({ json: [PUBLIC_EVENT] });
      return;
    }

    if (pathname === "/api/events/rotating/901") {
      await route.fulfill({ json: PUBLIC_EVENT });
      return;
    }

    if (pathname === "/api/events/rotating/901/roster-summary") {
      await route.fulfill({
        json: {
          confirmed: 0,
          waitlisted: 0,
          pendingApproval: 0,
          maxParticipants: PUBLIC_EVENT.maxParticipants,
        },
      });
      return;
    }

    if (pathname === "/api/events/rotating/901/registrations") {
      await route.fulfill({ json: [] });
      return;
    }

    if (pathname === "/api/events/rotating/901/registrations/request-code") {
      await route.fulfill({
        json: {
          sent: true,
          cooldownSeconds: 30,
          selfRatingRequired: false,
        },
      });
      return;
    }

    if (pathname === "/api/events/fixed_partner/902") {
      await route.fulfill({ json: PUBLIC_FIXED_PARTNER_EVENT });
      return;
    }

    if (pathname === "/api/events/fixed_partner/902/roster-summary") {
      await route.fulfill({
        json: {
          confirmed: 0,
          waitlisted: 0,
          pendingApproval: 0,
          maxParticipants: PUBLIC_FIXED_PARTNER_EVENT.maxParticipants,
          confirmedTeams: 0,
          maxTeams: PUBLIC_FIXED_PARTNER_EVENT.maxTeams,
        },
      });
      return;
    }

    if (pathname === "/api/events/fixed_partner/902/registrations") {
      await route.fulfill({ json: [] });
      return;
    }

    if (
      pathname === "/api/events/fixed_partner/902/registrations/request-code"
    ) {
      await route.fulfill({
        json: {
          sent: true,
          cooldownSeconds: 30,
          selfRatingRequired: false,
        },
      });
      return;
    }

    if (pathname === "/api/events/fixed_partner") {
      fixedPartnerEventsRequestCount += 1;
      const shouldFail =
        options.fixedPartnerEventsFailure === true ||
        (options.fixedPartnerEventsFailure === "once" &&
          fixedPartnerEventsRequestCount === 1);
      if (shouldFail) {
        await route.fulfill({
          status: 503,
          json: { error: "Fixed-partner events are temporarily unavailable" },
        });
        return;
      }
      await route.fulfill({ json: [PUBLIC_FIXED_PARTNER_EVENT] });
      return;
    }

    if (pathname === "/api/events/summary") {
      await route.fulfill({
        json: { rotating: 1, fixed_partner: 1 },
      });
      return;
    }

    if (pathname === "/api/settings") {
      await route.fulfill({ json: {} });
      return;
    }

    if (pathname === "/api/users") {
      await route.fulfill({
        status: 401,
        json: { error: "Not authenticated" },
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unexpected mocked path: ${pathname}` },
    });
  });

  return requests;
}

test("anonymous visitors can open event details but cannot enter admin routes", async ({
  page,
}) => {
  const requests = await mockAnonymousVisitorApi(page);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Upcoming Events" }),
  ).toBeVisible();
  await expect(page.getByTestId(`card-event-${PUBLIC_EVENT.id}`)).toBeVisible();

  await page.getByTestId(`card-event-${PUBLIC_EVENT.id}`).click();
  await expect(page).toHaveURL(/\/events\/rotating\/901$/);
  await expect(
    page.getByRole("heading", { name: PUBLIC_EVENT.name }),
  ).toBeVisible();
  await expect(page.getByTestId("card-event-description")).toContainText(
    "Public event details.",
  );
  await expect(page.getByTestId("card-registration")).toBeVisible();

  await page.getByTestId("input-reg-email").fill("visitor@example.com");
  await page.getByTestId("button-send-code").click();
  await expect(page.getByTestId("input-reg-code")).toBeVisible();

  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Admin Sign In" }),
  ).toBeVisible();

  expect(
    await page.evaluate(() => localStorage.getItem("authToken")),
  ).toBeNull();
  await expect
    .poll(async () =>
      (await page.context().cookies()).find((cookie) => cookie.name === "sid"),
    )
    .toBeUndefined();
  expect(
    requests.every(
      ({ headers }) =>
        !headers.authorization && !headers.cookie?.includes("sid="),
    ),
  ).toBe(true);

  expect(
    requests.filter(
      ({ method, pathname }) =>
        pathname === "/api/auth/login" && method === "POST",
    ),
  ).toHaveLength(0);
});

test("anonymous visitors can open fixed-partner event details and see partner requirements", async ({
  page,
}) => {
  const requests = await mockAnonymousVisitorApi(page);

  await page.goto("/events/fixed_partner/902");
  await expect(page).toHaveURL(/\/events\/fixed_partner\/902$/);
  await expect(
    page.getByRole("heading", { name: PUBLIC_FIXED_PARTNER_EVENT.name }),
  ).toBeVisible();
  await expect(page.getByTestId("card-event-description")).toContainText(
    "Fixed-partner event details.",
  );
  await expect(page.getByTestId("card-event-guidelines")).toContainText(
    "Fixed-partner registration guidelines.",
  );
  await expect(page.getByTestId("card-registration")).toBeVisible();
  await expect(page.getByTestId("input-partner-email")).toBeVisible();
  await expect(page.getByText("Partner's Email", { exact: true })).toBeVisible();

  expect(
    await page.evaluate(() => localStorage.getItem("authToken")),
  ).toBeNull();
  await expect
    .poll(async () =>
      (await page.context().cookies()).find((cookie) => cookie.name === "sid"),
    )
    .toBeUndefined();
  expect(
    requests.every(
      ({ headers }) =>
        !headers.authorization && !headers.cookie?.includes("sid="),
    ),
  ).toBe(true);
});

test("anonymous visitors see a format-specific error when fixed-partner events cannot load", async ({
  page,
}) => {
  const requests = await mockAnonymousVisitorApi(page, {
    fixedPartnerEventsFailure: true,
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Upcoming Events" })).toBeVisible();
  await page.getByTestId("tab-fixed_partner").click();

  const error = page.getByTestId("event-list-error-fixed_partner");
  await expect(error).toBeVisible();
  await expect(error).toContainText("Unable to load fixed-partner events");
  await expect(error).toContainText("Please try again later.");
  await expect(page.getByText("No upcoming events", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId(`card-event-${PUBLIC_FIXED_PARTNER_EVENT.id}`)).toHaveCount(0);

  const repeatedFailure = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/events/fixed_partner" &&
      response.status() === 503,
  );
  await page.getByTestId("button-retry-event-list-fixed_partner").click();
  await repeatedFailure;
  await expect(error).toBeVisible();
  await expect(error).toContainText("Unable to load fixed-partner events");
  await expect(
    page.getByTestId("button-retry-event-list-fixed_partner"),
  ).toHaveText("Try again");
  expect(
    requests.filter(
      ({ method, pathname }) =>
        method === "GET" && pathname === "/api/events/fixed_partner",
    ),
  ).toHaveLength(2);
});

test("anonymous visitors can retry a failed event format without affecting the other list", async ({
  page,
}) => {
  const requests = await mockAnonymousVisitorApi(page, {
    fixedPartnerEventsFailure: "once",
  });

  await page.goto("/");
  await expect(page.getByTestId(`card-event-${PUBLIC_EVENT.id}`)).toBeVisible();
  await page.getByTestId("tab-fixed_partner").click();

  const error = page.getByTestId("event-list-error-fixed_partner");
  await expect(error).toBeVisible();
  await expect(error).toContainText("Unable to load fixed-partner events");
  await expect(
    page.getByTestId("button-retry-event-list-fixed_partner"),
  ).toHaveText("Try again");

  const initialUrl = page.url();
  const recoveredEventResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/events/fixed_partner" &&
      response.status() === 200,
  );
  await page.getByTestId("button-retry-event-list-fixed_partner").click();
  await recoveredEventResponse;

  await expect(
    page.getByTestId(`card-event-${PUBLIC_FIXED_PARTNER_EVENT.id}`),
  ).toBeVisible();
  await expect(
    page.getByTestId("event-list-error-fixed_partner"),
  ).toHaveCount(0);
  expect(page.url()).toBe(initialUrl);
  expect(
    requests.filter(
      ({ method, pathname }) =>
        method === "GET" && pathname === "/api/events/fixed_partner",
    ),
  ).toHaveLength(2);

  await page.getByTestId("tab-rotating").click();
  await expect(page.getByTestId(`card-event-${PUBLIC_EVENT.id}`)).toBeVisible();
  await expect(
    page.getByTestId(`card-event-${PUBLIC_FIXED_PARTNER_EVENT.id}`),
  ).toHaveCount(0);
});

test("anonymous visitors can open fixed-partner events from the public event list", async ({
  page,
}) => {
  const requests = await mockAnonymousVisitorApi(page);

  await page.goto("/");
  await expect(page.getByTestId("tab-fixed_partner")).toBeVisible();
  await page.getByTestId("tab-fixed_partner").click();

  const eventCard = page.getByTestId(
    `card-event-${PUBLIC_FIXED_PARTNER_EVENT.id}`,
  );
  await expect(eventCard).toBeVisible();
  await expect(eventCard).toContainText(PUBLIC_FIXED_PARTNER_EVENT.name);

  await eventCard.click();
  await expect(page).toHaveURL(/\/events\/fixed_partner\/902$/);
  await expect(
    page.getByRole("heading", { name: PUBLIC_FIXED_PARTNER_EVENT.name }),
  ).toBeVisible();
  await expect(page.getByTestId("card-event-description")).toContainText(
    "Fixed-partner event details.",
  );
  await expect(page.getByTestId("card-event-guidelines")).toContainText(
    "Fixed-partner registration guidelines.",
  );
  await expect(page.getByTestId("card-registration")).toBeVisible();
  await expect(page.getByTestId("input-partner-email")).toBeVisible();
  await expect(page.getByText("Partner's Email", { exact: true })).toBeVisible();

  expect(
    await page.evaluate(() => localStorage.getItem("authToken")),
  ).toBeNull();
  await expect
    .poll(async () =>
      (await page.context().cookies()).find((cookie) => cookie.name === "sid"),
    )
    .toBeUndefined();
  expect(
    requests.every(
      ({ headers }) =>
        !headers.authorization && !headers.cookie?.includes("sid="),
    ),
  ).toBe(true);
});
