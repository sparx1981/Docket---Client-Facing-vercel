import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config. The dev server here is the frontend only (`dev:web`) — tests
 * that need the backend mock it via page.route() instead of hitting the real
 * TheStatsAPI, since no real API key exists in this environment. Sign-in is
 * real (Firebase Auth), just not real Google OAuth — that can't be automated
 * headlessly, so the frontend runs with VITE_USE_FIREBASE_EMULATOR=true and
 * talks to the Firebase Auth/Firestore Emulator Suite (started below)
 * instead, using the test-only sign-in path LoginScreen exposes under that
 * same flag.
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
  webServer: [
    {
      command:
        'npx --yes firebase-tools emulators:start --only auth,firestore --project demo-docket-e2e',
      url: 'http://127.0.0.1:9099',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        VITE_USE_FIREBASE_EMULATOR: 'true',
      },
    },
  ],
});
