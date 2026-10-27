import { defineConfig, devices } from "@playwright/test";

const PORT = 4322;

/**
 * End-to-end tests run against the production server build, the same entry
 * point the container uses. Run `npm run build` first; CI does.
 */
export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Lets a machine with a preinstalled Chromium skip `playwright install`.
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: {
    command: "node dist/server/entry.mjs",
    url: `http://127.0.0.1:${PORT}/api/health`,
    // Rooms push through the local WebSocket stand-in (ADR-019), as API Gateway does in AWS.
    env: { HOST: "127.0.0.1", PORT: String(PORT), ROOMS_PUSH_LOCAL_PORT: String(PORT + 1), ROOMS_LIMIT_MULTIPLIER: "100" },
    reuseExistingServer: !process.env.CI,
  },
});
