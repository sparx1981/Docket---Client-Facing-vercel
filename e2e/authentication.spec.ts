import { test, expect } from '@playwright/test';

test.describe('Authentication & Cloud Synchronization UI', () => {
  test('displays the Google Login entry screen by default for new visitors', async ({ page }) => {
    await page.goto('/');
    
    // Login screen elements
    await expect(page.locator('#login-screen')).toBeVisible();
    await expect(page.locator('#btn-google-sign-in')).toBeVisible();
    await expect(page.locator('#btn-guest-continue')).toBeVisible();
    
    // Cloud storage & authentication messaging
    await expect(page.locator('#login-screen')).toContainText('Sign in with Google');
    await expect(page.locator('#login-screen')).toContainText('Firebase Firestore');
    await expect(page.locator('#login-screen')).toContainText('Cross-Device Engine Sync');
  });

  test('continuing as guest/sandbox enters the Docket application shell', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-guest-continue');
    
    // Verifies application shell is rendered
    await expect(page.locator('#nav-verified')).toBeVisible();
    await expect(page.locator('#nav-settings')).toBeVisible();
    
    // Can navigate to Settings and see Firebase database callout
    await page.click('#nav-settings');
    await expect(page.locator('#settings-view')).toBeVisible();
    await expect(page.locator('#settings-view')).toContainText('Firebase Firestore');
    await page.getByRole('button', { name: /Cloud-Persisted Engine & Synced Betting Data/i }).click();
    await expect(page.locator('#settings-view')).toContainText('Firebase Firestore cloud database');
  });
});
