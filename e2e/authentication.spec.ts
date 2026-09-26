import { test, expect } from '@playwright/test';
import { signIn } from './authHelpers';

test.describe('Authentication & Cloud Synchronization UI', () => {
  test('displays the Google Sign-In entry screen by default for signed-out visitors', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#btn-google-login')).toBeVisible();
    await expect(page.getByText('Sign in with Google')).toBeVisible();
    await expect(page.getByText('The Docket')).toBeVisible();

    // No app shell content should be reachable while signed out.
    await expect(page.locator('#nav-verified')).toHaveCount(0);
  });

  test('signing in enters the Docket application shell and shows Firebase cloud sync messaging', async ({ page }) => {
    await signIn(page);

    await expect(page.locator('#nav-verified')).toBeVisible();
    await expect(page.locator('#nav-settings')).toBeVisible();
    await expect(page.locator('#nav-help')).toBeVisible();

    await page.click('#nav-settings');
    await expect(page.locator('#settings-view')).toBeVisible();
    await page.click('#btn-toggle-cloud-storage');
    await expect(page.locator('#settings-view')).toContainText('Firebase Firestore cloud database');
    await expect(page.locator('#settings-view')).toContainText('Cloud-Persisted Engine');
  });

  test('signing out returns to the login screen', async ({ page }) => {
    await signIn(page);
    await page.click('#btn-header-sign-out');
    await expect(page.locator('#btn-google-login')).toBeVisible();
  });
});
