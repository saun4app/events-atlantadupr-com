import { expect, test, type Page } from "@playwright/test";

const ADMIN_USER = {
  id: 1,
  name: "Test Admin",
  username: "admin",
  role: "app_admin",
  createdAt: "2026-01-01T00:00:00.000Z",
  duprId: null,
  duprFullname: null,
};

const CLUB_MEMBER = {
  id: 2,
  name: "Current Club Member",
  username: "current-member",
  role: "club_member",
  createdAt: "2026-01-01T00:00:00.000Z",
  duprId: null,
  duprFullname: null,
};

const LEGACY_PARTICIPANT = {
  id: 3,
  name: "Legacy Participant",
  username: "legacy-participant",
  role: "event_participant",
  createdAt: "2026-01-01T00:00:00.000Z",
  duprId: null,
  duprFullname: null,
};

async function mockUserManagementApi(page: Page) {
  const users = [ADMIN_USER, CLUB_MEMBER, LEGACY_PARTICIPANT];
  let createPayload: Record<string, unknown> | undefined;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === "/api/auth/me") {
      await route.fulfill({ json: ADMIN_USER });
      return;
    }

    if (pathname === "/api/users") {
      if (request.method() === "POST") {
        createPayload = request.postDataJSON() as Record<string, unknown>;
        const createdUser = {
          id: 4,
          name: createPayload.name,
          username: createPayload.username,
          role: createPayload.role,
          createdAt: "2026-01-01T00:00:00.000Z",
          duprId: null,
          duprFullname: null,
        };
        users.push(createdUser as typeof ADMIN_USER);
        await route.fulfill({ status: 201, json: createdUser });
        return;
      }

      await route.fulfill({ json: users });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { error: `Unexpected mocked path: ${pathname}` },
    });
  });

  return {
    getCreatePayload: () => createPayload,
  };
}

test("user management displays and creates Club Members safely during role rollout", async ({
  page,
}) => {
  const api = await mockUserManagementApi(page);
  await page.goto("/admin/users");

  await expect(page.getByTestId("row-user-2")).toContainText("Club Member");
  await expect(page.getByTestId("row-user-3")).toContainText("Club Member");

  await page.getByTestId("button-add-user").click();
  await page.getByTestId("input-new-user-name").fill("New Club Member");
  await page.getByTestId("input-new-user-username").fill("new-member");
  await page.getByTestId("input-new-user-password").fill("test-password");

  await page.getByTestId("select-new-user-role").click();
  await expect(page.getByRole("option", { name: "Club Member" })).toBeVisible();
  await page.getByRole("option", { name: "Club Member" }).click();
  await page.getByTestId("button-submit-add-user").click();

  await expect.poll(api.getCreatePayload).toMatchObject({
    name: "New Club Member",
    username: "new-member",
    password: "test-password",
    role: "club_member",
  });
  await expect(page.getByTestId("row-user-4")).toContainText("Club Member");
});