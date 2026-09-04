import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

const fixture = resolve('test/fixtures/real-usgs.gpx')

// Settings live in `localStorage` under 'jddc.settings.v1', independent of any
// project — this is the one behavior no unit test can see (state/settings.ts's
// own tests run in Node, with no `window`/`localStorage` at all): does a
// preference actually survive a real page reload, and does a dependent panel
// (Transform) actually pick it up on the next mount. Playwright gives each
// test its own browser context (fresh storage) by default, but the key is
// cleared explicitly anyway rather than relying on that alone.
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.localStorage.removeItem('jddc.settings.v1'))
})

test('default motion profile persists across a reload and is picked up by the Transform tab', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  const profileSelect = page.getByLabel('Default motion profile')
  await expect(profileSelect).toHaveValue('aircraft')
  await profileSelect.selectOption('marine')
  await expect(profileSelect).toHaveValue('marine')

  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByLabel('Default motion profile')).toHaveValue('marine')

  // A dataset is required to reach the Transform tab's motion-profile pickers.
  await page.locator('input[type=file][multiple]').first().setInputFiles(fixture)
  await page.getByRole('button', { name: 'Transform', exact: true }).click()
  const outlierCard = page.locator('.op-card').filter({ hasText: 'Drop outliers' })
  await expect(outlierCard.getByLabel('motion profile')).toHaveValue('marine')
})

test('point budget settings persist across a reload and "Reset to defaults" restores every field', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()

  const chartBudget = page.getByLabel('Chart point budget')
  const defaultValue = await chartBudget.inputValue()
  await chartBudget.fill('2500')
  await chartBudget.blur()
  await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeEnabled()

  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByLabel('Chart point budget')).toHaveValue('2500')

  await page.getByRole('button', { name: 'Reset to defaults' }).click()
  await expect(page.getByLabel('Chart point budget')).toHaveValue(defaultValue)
  await expect(page.getByLabel('Default motion profile')).toHaveValue('aircraft')
  await expect(page.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
})
