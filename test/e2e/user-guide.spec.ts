import { expect, test } from '@playwright/test'

// The guide is a static document outside the React app, so nothing else in the
// suite would notice if it stopped being served, if a screenshot path drifted,
// or if the button lost its handler.
test('the header info button opens the user guide with every screenshot intact', async ({ page }) => {
  await page.goto('/')
  const button = page.getByRole('button', { name: 'Open the user guide' })
  await expect(button).toBeVisible()
  const popup = page.waitForEvent('popup')
  await button.click()
  const guide = await popup
  await guide.waitForLoadState('domcontentloaded')
  expect(guide.url()).toContain('user-guide.html')
  await expect(guide).toHaveTitle(/User Guide/)

  // A broken screenshot path is silent in a browser -- it renders as alt text
  // and nothing errors -- so it has to be asserted explicitly.
  const images = await guide.evaluate(() => ({
    total: document.images.length,
    broken: Array.from(document.images).filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.getAttribute('src')),
  }))
  expect(images.total).toBeGreaterThan(15)
  expect(images.broken).toEqual([])
  await guide.close()

  // And the second entry point, in Settings.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.locator('.settings-header').getByRole('button', { name: 'Open the user guide' })).toBeVisible()
})
