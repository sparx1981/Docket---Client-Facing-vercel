import { Page } from '@playwright/test';

/**
 * Signs in via the Firebase Auth Emulator's anonymous test-only path (see
 * LoginScreen's #btn-test-sign-in, only rendered when
 * VITE_USE_FIREBASE_EMULATOR=true — set for every e2e run by
 * playwright.config.ts). Real Google OAuth can't be automated headlessly,
 * so this is the one and only sign-in path e2e tests use.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.click('#btn-test-sign-in');
  await page.locator('#nav-verified').waitFor({ state: 'visible', timeout: 20_000 });
}
