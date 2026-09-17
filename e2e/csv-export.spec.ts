import { test, expect } from '@playwright/test';

const SEEDED_BET = {
  id: 'TEST-001',
  date: '2026-09-01',
  fixtureId: 'TEST-FX-1',
  sport: 'football',
  system: 'football_over_1_5',
  match: 'Test United vs Test Rovers',
  competition: 'Test League',
  selection: 'Over 1.5 Goals',
  oddsTaken: 1.18,
  stake: 100,
  outcome: 'WON',
  finalScore: '2 - 1',
  settledAt: '2026-09-01T18:00:00Z',
  pnl: 18,
  roiContribution: 18,
  auditId: 'AUDIT-TEST-1',
  notes: 'Seeded by e2e test — not a real result.',
  dataSourceName: 'Test fixture',
};

test.describe('Archive log CSV export', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((bet) => {
      sessionStorage.setItem('sports_selection_guest_mode', 'true');
      localStorage.setItem('sports_selection_historical_v2', JSON.stringify([bet]));
      // Prevent the one-shot historical backfill from firing during this test.
      localStorage.setItem('sports_selection_backfill_attempted_v1', 'true');
    }, SEEDED_BET);
    await page.goto('/');
    await page.click('#nav-analytics');
  });

  test('export button is enabled once the archive has rows', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export csv/i });
    await expect(exportBtn).toBeEnabled();
  });

  test('downloads a CSV containing the real seeded row, not placeholder data', async ({ page }) => {
    const exportBtn = page.getByRole('button', { name: /export csv/i });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportBtn.click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^archive-log-all-\d{4}-\d{2}-\d{2}\.csv$/);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf-8');

    expect(csv).toContain('Date,Match,Competition,System,Selection');
    expect(csv).toContain('Test United vs Test Rovers');
    expect(csv).toContain('WON');
    expect(csv).toContain('1.18');
  });

  test('respects the outcome filter — exporting "Pending" excludes the seeded WON row', async ({ page }) => {
    await page.getByRole('tab', { name: 'Pending', exact: true }).click();
    // Nothing pending is seeded, so the export button must reflect that
    // honestly (disabled), not offer to export an empty/mismatched file.
    const exportBtn = page.getByRole('button', { name: /export csv/i });
    await expect(exportBtn).toBeDisabled();
  });
});
