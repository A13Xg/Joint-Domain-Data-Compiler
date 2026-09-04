import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

// A smooth 40-sample eastbound leg with three ~200 m lateral position spikes.
// Synthetic on purpose: the flow under test only appears when the outlier check
// actually fails, which needs more than `maxFlaggedFraction` (5%) of evaluated
// points flagged -- no real-capture fixture in the suite trips that.
const fixture = resolve('test/fixtures/outlier-spikes.csv')

const outlierCheck = (page: import('@playwright/test').Page) =>
  page.locator('.health-check').filter({ hasText: 'Outliers' })

const interpolatedRow = (page: import('@playwright/test').Page) =>
  page.locator('.track-metrics tr').filter({ hasText: 'interpolated' })

async function importFixture(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Overview', exact: true }).click()
  // The scan is asynchronous; everything below reads its results.
  await expect(page.locator('.health-score-badge')).toBeVisible()
}

async function score(page: import('@playwright/test').Page): Promise<number> {
  return Number((await page.locator('.health-number').innerText()).trim())
}

// Track Health's remediation button is the only UI entry to the repair engine
// 0.3.0 rewrote (reconstruct-in-place through the shared trackReconstruction.ts).
// Unit tests cover the engine; only a browser run covers scan -> repair ->
// accept-or-revert -> rescan as one flow.
test('a flagged track can be repaired in place from Track Health', async ({ page }) => {
  await importFixture(page)

  await expect(outlierCheck(page)).toHaveClass(/health-check-fail/)
  await expect(outlierCheck(page)).toContainText('break the local trend')
  const scoreBefore = await score(page)
  await expect(page.locator('.health-meta')).toContainText('40')

  await outlierCheck(page).getByRole('button', { name: 'Repair flagged points' }).click()

  // Nothing is applied until Accept: the dialog is a gate, not a progress notice.
  const dialog = page.locator('.dialog-backdrop')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('reconstructed')
  await dialog.getByRole('button', { name: 'Revert', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(outlierCheck(page)).toHaveClass(/health-check-fail/)
  expect(await score(page)).toBe(scoreBefore)

  await outlierCheck(page).getByRole('button', { name: 'Repair flagged points' }).click()
  await page.locator('.dialog-backdrop').getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.locator('.dialog-backdrop')).toBeHidden()

  // The repair refits flagged samples from their neighbours rather than
  // deleting them, so the track keeps every point it started with.
  await expect(outlierCheck(page)).toHaveClass(/health-check-pass/, { timeout: 15_000 })
  await expect(outlierCheck(page)).toContainText('No significant outliers')
  await expect(page.locator('.health-meta')).toContainText('40')
  expect(await score(page)).toBeGreaterThan(scoreBefore)
})

test('the repaired points are marked as reconstructed, not passed off as observed', async ({ page }) => {
  await importFixture(page)
  // Nothing is interpolated before the repair, so the row below cannot be a
  // pre-existing artefact of the fixture.
  await expect(interpolatedRow(page)).toHaveCount(0)

  await outlierCheck(page).getByRole('button', { name: 'Repair flagged points' }).click()
  await page.locator('.dialog-backdrop').getByRole('button', { name: 'Accept', exact: true }).click()
  await expect(page.locator('.dialog-backdrop')).toBeHidden()
  await expect(outlierCheck(page)).toHaveClass(/health-check-pass/, { timeout: 15_000 })

  // Never fabricate data silently (AGENTS.md non-negotiable #1): a refitted
  // sample has to stay countable and distinguishable from a recorded one, which
  // Track Metrics' point accounting reports straight off `provenance`.
  await expect(interpolatedRow(page).locator('td').last()).toHaveText('6')
})
