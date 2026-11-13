import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.use({
  trace: "off",
  screenshot: "off",
  video: "off",
});

type TestAccount = {
  userId: number;
  username: string;
  password: string;
};

type FixtureResult = {
  cleaned?: boolean;
};

function runAccountFixture(input: object): string {
  try {
    return execFileSync(
      "pnpm",
      [
        "--filter",
        "@workspace/api-server",
        "exec",
        "tsx",
        "scripts/e2e-auth-account.ts",
      ],
      {
        input: JSON.stringify(input),
        encoding: "utf8",
      },
    );
  } catch {
    throw new Error("Could not manage the disposable sign-in test account.");
  }
}

test("admin sign-in persists through reload and logout blocks App Settings", async ({
  page,
  context,
}) => {
  let secondPage: Awaited<ReturnType<typeof context.newPage>> | undefined;
  const account = JSON.parse(
    runAccountFixture({ action: "create" }),
  ) as TestAccount;

  try {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Admin Sign In" }),
    ).toBeVisible();

    await page.getByTestId("input-username").fill(account.username);
    await page.getByTestId("input-password").fill(account.password);
    await page.getByTestId("button-submit").click();
    await expect(page).toHaveURL(/\/admin\/events\/rotating$/);

    await page.goto("/admin/settings");
    await expect(
      page.getByRole("heading", { name: "App Settings" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "General" })).toBeVisible();

    const sessionCookie = (await context.cookies()).find(
      (cookie) => cookie.name === "sid",
    );
    expect(Boolean(sessionCookie)).toBe(true);
    expect(sessionCookie?.httpOnly).toBe(true);

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "App Settings" }),
    ).toBeVisible();

    secondPage = await context.newPage();
    await secondPage.goto("/admin/settings");
    await expect(
      secondPage.getByRole("heading", { name: "App Settings" }),
    ).toBeVisible();

    const logoutResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/logout" &&
        response.request().method() === "POST",
    );
    const secondTabUnauthorizedPromise = secondPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/me" &&
        response.status() === 401,
    );
    await page.getByTestId("button-logout").click();
    const logoutResponse = await logoutResponsePromise;
    expect(logoutResponse.status()).toBe(204);

    await expect(secondPage).toHaveURL(/\/login$/);
    const reloadedTabUnauthorizedPromise = secondPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/me" &&
        response.status() === 401,
    );
    await secondPage.reload();
    expect((await reloadedTabUnauthorizedPromise).status()).toBe(401);

    const protectedRouteUnauthorizedPromise = secondPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/me" &&
        response.status() === 401,
    );
    await secondPage.goto("/admin/settings");
    expect((await protectedRouteUnauthorizedPromise).status()).toBe(401);
    await expect(secondPage).toHaveURL(/\/login$/);
    await expect(
      secondPage.getByRole("heading", { name: "Admin Sign In" }),
    ).toBeVisible();
  } finally {
    await secondPage?.close();
    const cleanup = JSON.parse(
      runAccountFixture({
        action: "cleanup",
        userId: account.userId,
        username: account.username,
      }),
    ) as FixtureResult;
    expect(cleanup.cleaned).toBe(true);
  }
});

test("expired admin sessions redirect protected pages to sign-in", async ({
  page,
}) => {
  const account = JSON.parse(
    runAccountFixture({ action: "create" }),
  ) as TestAccount;

  try {
    await page.goto("/login");
    await page.getByTestId("input-username").fill(account.username);
    await page.getByTestId("input-password").fill(account.password);
    await page.getByTestId("button-submit").click();
    await expect(page).toHaveURL(/\/admin\/events\/rotating$/);

    await page.goto("/admin/settings");
    await expect(
      page.getByRole("heading", { name: "App Settings" }),
    ).toBeVisible();

    const expired = JSON.parse(
      runAccountFixture({
        action: "expire",
        userId: account.userId,
        username: account.username,
      }),
    ) as { expired?: boolean };
    expect(expired.expired).toBe(true);

    const meResponsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/me" &&
        response.request().method() === "GET",
    );
    await page.reload();
    const meResponse = await meResponsePromise;
    expect(meResponse.status()).toBe(401);
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Admin Sign In" }),
    ).toBeVisible();
  } finally {
    const cleanup = JSON.parse(
      runAccountFixture({
        action: "cleanup",
        userId: account.userId,
        username: account.username,
      }),
    ) as FixtureResult;
    expect(cleanup.cleaned).toBe(true);
  }
});
