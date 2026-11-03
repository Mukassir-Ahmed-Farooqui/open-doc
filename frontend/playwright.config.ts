import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a REAL running stack (API + Postgres/pgvector + this SPA).
 * Nothing is mocked. Start the API, build the SPA with VITE_API_URL pointing at it, then:
 *   E2E_BASE_URL=http://127.0.0.1:4173 npx playwright test
 * Set CHROMIUM_PATH to use a system Chromium (e.g. on linux-arm64 where Playwright has no build).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
