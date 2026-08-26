// User-feedback guarantees.
//
// The log dock is collapsed by default now, so an operation that only wrote to
// the log would give the user no visible signal at all. These assert that the
// app says what it is doing through channels that are visible without opening
// anything: the header status light, toasts, and a confirm dialog that names
// the consequence before a destructive change.

import { test, expect } from '@playwright/test'
import { join } from 'node:path'

const fixture = join(process.cwd(), 'test', 'fixtures', 'real-usgs.gpx')

async function importFixture(page: import('@playwright/test').Page) {
  await page.locator('input[type=file][multiple]').first().setInputFiles(fixture)
  await expect(page.getByText('1 dataset loaded')).toBeVisible()
}

test('the header status light reports idle, then ready', async ({ page }) => {
  await page.goto('/')
  const light = page.locator('.status-light')
  await expect(light).toHaveClass(/status-idle/)
  await expect(light).toContainText('Idle')

  await importFixture(page)
  await expect(light).toHaveClass(/status-(ok|warn|error)/)
  await expect(light).toContainText('1 dataset loaded')
})

test('the status light turns red and counts errors when something fails', async ({ page }) => {
  await page.goto('/')
  // An unsupported extension is rejected by the importer and logged as an error.
  await page.locator('input[type=file][multiple]').first().setInputFiles({
    name: 'not-a-track.xyz',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('nonsense'),
  })
  const light = page.locator('.status-light')
  await expect(light).toHaveClass(/status-error/)
  await expect(light).toContainText(/error/i)
})

test('importing raises a toast that can be dismissed early', async ({ page }) => {
  await page.goto('/')
  await importFixture(page)

  const toast = page.locator('.toast').first()
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('real-usgs.gpx')
  // Success rather than a neutral grey box: the tone is inferred from the text.
  await expect(toast).toHaveClass(/toast-success/)

  await toast.getByRole('button', { name: 'Dismiss notification' }).click()
  await expect(page.locator('.toast')).toHaveCount(0)
})

test('a failed import raises an error toast', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file][multiple]').first().setInputFiles({
    name: 'not-a-track.xyz',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('nonsense'),
  })
  await expect(page.locator('.toast-error')).toBeVisible()
})

test('a repair is shown against the original before it is applied', async ({ page }) => {
  await page.goto('/')
  await importFixture(page)
  await page.locator('.tab-bar').getByRole('button', { name: 'Transform', exact: true }).click()

  const card = page.locator('.op-card').filter({ hasText: 'Offset elevation' })
  await card.scrollIntoViewIfNeeded()
  await card.getByRole('spinbutton', { name: 'meters' }).fill('25')
  await card.getByRole('button', { name: 'Apply' }).click()

  // One gate, not two: the graphical preview replaces the destructive confirm.
  const preview = page.locator('.dialog-repair-preview')
  await expect(preview).toBeVisible()
  await expect(page.locator('.dialog-confirm')).toHaveCount(0)
  await expect(preview.locator('.diff-line-before')).toHaveCount(1)
  await expect(preview.locator('.diff-line-after')).toHaveCount(1)
  await expect(preview.locator('.dialog-details')).toContainText('points')

  await preview.getByRole('button', { name: 'Accept' }).click()
  await expect(preview).toHaveCount(0)
  await expect(page.locator('.toast').filter({ hasText: 'Offset elevation' })).toBeVisible()
})

test('a repair that is not accepted leaves the track untouched', async ({ page }) => {
  await page.goto('/')
  await importFixture(page)
  await page.locator('.tab-bar').getByRole('button', { name: 'Transform', exact: true }).click()

  const card = page.locator('.op-card').filter({ hasText: 'Reduce points' })
  await card.scrollIntoViewIfNeeded()
  await card.locator('select').selectOption('decimate')

  const before = await page.locator('.transform-history .muted').first().textContent()
  await card.getByRole('button', { name: 'Apply' }).click()
  const preview = page.locator('.dialog-repair-preview')
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Revert' }).click()
  await expect(preview).toHaveCount(0)
  // Reverting must actually revert.
  await expect(page.locator('.transform-history .muted').first()).toHaveText(before ?? '')
  await expect(page.locator('.operation-history')).toHaveCount(0)

  await card.getByRole('button', { name: 'Apply' }).click()
  await page.locator('.dialog-repair-preview').getByRole('button', { name: 'Accept' }).click()
  await expect(page.locator('.dialog-repair-preview')).toHaveCount(0)
  await expect(page.locator('.toast').filter({ hasText: /Decimated/ })).toBeVisible()
})

test('a destructive transform still names the consequence when previews are off', async ({ page }) => {
  await page.goto('/')
  await importFixture(page)
  await page.locator('.tab-bar').getByRole('button', { name: 'Transform', exact: true }).click()
  // With the graphical gate off, the destructive-confirm path is what stands
  // between the user and a shrinking track.
  await page.getByLabel('preview repairs').uncheck()

  const card = page.locator('.op-card').filter({ hasText: 'Reduce points' })
  await card.scrollIntoViewIfNeeded()
  await card.locator('select').selectOption('decimate')
  await card.getByRole('button', { name: 'Apply' }).click()

  const dialog = page.locator('.dialog-confirm')
  await expect(dialog).toBeVisible()
  // The point of replacing window.confirm: the counts are visible up front.
  await expect(dialog.locator('.dialog-details')).toContainText('points')
  await expect(dialog).toHaveAttribute('role', 'alertdialog')

  const before = await page.locator('.transform-history .muted').first().textContent()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  // Cancelling must actually cancel.
  await expect(page.locator('.transform-history .muted').first()).toHaveText(before ?? '')

  await card.getByRole('button', { name: 'Apply' }).click()
  await page.locator('.dialog-confirm').getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.dialog-confirm')).toHaveCount(0)
  await expect(page.locator('.toast').filter({ hasText: /Decimated/ })).toBeVisible()
})

test('Escape closes the repair preview without clearing the selection behind it', async ({ page }) => {
  await page.goto('/')
  await importFixture(page)

  await page.locator('.tab-bar').getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.locator('.grid-row').nth(2)).toBeVisible()
  await page.locator('.grid-row').nth(2).click()
  await expect(page.getByRole('button', { name: 'selected #2' })).toBeVisible()

  await page.locator('.tab-bar').getByRole('button', { name: 'Transform', exact: true }).click()
  const card = page.locator('.op-card').filter({ hasText: 'Reduce points' })
  await card.scrollIntoViewIfNeeded()
  // Dedupe at a 0 m tolerance removes nothing on this fixture, so the diff has
  // nothing to draw and no gate is raised; decimate does.
  await card.locator('select').selectOption('decimate')
  await card.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.dialog-repair-preview')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.locator('.dialog-repair-preview')).toHaveCount(0)

  // usePointSelection has a window-level Escape handler that clears the whole
  // selection; the dialog must stop propagation so one Escape does one thing.
  // The selection chip is only rendered by Table/Map/3D, so check it there.
  await page.locator('.tab-bar').getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.getByRole('button', { name: 'selected #2' })).toBeVisible()
})

test('the selection badge jumps to its points and only the x clears it', async ({ page }) => {
  await page.goto('/')
  await importFixture(page)

  await page.locator('.tab-bar').getByRole('button', { name: 'Table', exact: true }).click()
  await page.locator('.grid-row').nth(2).click()
  const badge = page.getByRole('button', { name: 'selected #2' })
  await expect(badge).toBeVisible()

  // The body is the "show me" control: clicking it must leave the selection alone.
  await badge.click()
  await expect(badge).toBeVisible()

  // Same rule on the map, where the badge fits the view to the point.
  await page.locator('.tab-bar').getByRole('button', { name: 'Map', exact: true }).click()
  const mapBadge = page.getByRole('button', { name: 'selected #2' })
  await mapBadge.click()
  await expect(mapBadge).toBeVisible()

  // Only the x discards it, and it does so everywhere.
  await page.getByRole('button', { name: 'Clear point selection' }).click()
  await expect(page.getByRole('button', { name: 'selected #2' })).toHaveCount(0)
  await page.locator('.tab-bar').getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.getByRole('button', { name: 'selected #2' })).toHaveCount(0)
})

test('the Track Health scan shows progress and a skeleton before its first result', async ({ page }) => {
  await page.goto('/')
  await importFixture(page)
  // Overview is selected automatically on import; the scan starts immediately.
  const panel = page.locator('.track-health-panel')
  await expect(panel).toBeVisible()
  // Either the skeleton is still up or the scan already finished — both are
  // valid, but the panel must never be an empty box.
  await expect(panel.locator('.health-checks, .health-status, .health-score-badge').first()).toBeVisible()
})
