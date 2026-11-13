import { defineConfig, devices } from "@playwright/test";

const port = 20563;
const baseURL = `http://127.0.0.1:${port}`;
const apiPort = 8080;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required for browser tests; refusing to use a development database.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  outputDir:
    process.env.PLAYWRIGHT_OUTPUT_DIR ?? "/tmp/atl-dupr-playwright-output",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    ...(chromiumExecutablePath
      ? { launchOptions: { executablePath: chromiumExecutablePath } }
      : {}),
  },
  webServer: [
    {
      command: [
        "pnpm --filter @workspace/api-server run build",
        `SESSION_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')" CORS_ALLOWED_ORIGINS=${baseURL} PORT=${apiPort} pnpm --filter @workspace/api-server run start`,
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/api/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `PORT=${port} BASE_PATH=/ pnpm --filter @workspace/atl-dupr-pickleball run dev`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
});
