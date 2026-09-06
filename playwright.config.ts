import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3418",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3418",
    url: "http://127.0.0.1:3418/api/health",
    reuseExistingServer: !process.env.CI && !process.env.RECIPE_MOBILE_TEST,
    timeout: 120_000,
    env: {
      NODE_ENV: "development",
      DATA_ROOT: process.env.RECIPE_MOBILE_TEST ? mkdtempSync(join(tmpdir(), "recipe-mobile-")) : ".e2e-data",
      AUTH_SECRET: "e2e-only-secret-that-is-at-least-32-chars",
      SETUP_TOKEN: "e2e-setup-token",
      APP_ORIGIN: "http://127.0.0.1:3418",
    },
  },
});
