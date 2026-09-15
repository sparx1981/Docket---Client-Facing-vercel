import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. The dev server here is the frontend only (`dev:web`) — tests
 * that need the backend mock it via page.route() instead of hitting real
 * Sportradar/Sportmonks, since no real API keys exist in this environment.
 * A handful of tests do exercise the real local backend (server/index.ts)
 * for its own behavior (e.g. a missing key returning 400) — those start it
 * themselves in a beforeAll rather than relying on the global webServer.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // This sandbox ships a pre-installed Chromium pinned to a specific
        // build; @playwright/test's own version may expect a newer one that
        // isn't present (and downloading is not available here). Point
        // directly at the pre-installed binary instead.
        launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
      },
    },
  ],
  webServer: {
    command: 'npm run dev:web',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
