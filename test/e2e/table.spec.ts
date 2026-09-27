import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

test('the table fills the tab, shows whole timestamps, and exports full precision', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 })
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(resolve('test/fixtures/demo-flight-a.csv'))
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Table', exact: true }).click()

  const grid = page.getByRole('grid')
  // It used to be a fixed 460 px box whatever the window height.
  expect((await grid.boundingBox())!.height).toBeGreaterThan(600)

  // Display: coordinates at a fixed six decimals, and the whole ISO instant.
  const firstRow = grid.getByRole('row').nth(1)
  await expect(firstRow).toContainText('-77.000000')
  await expect(firstRow).toContainText('2026-06-09T16:00:00.000Z')

  // Export: the raw values, not the display rounding (the second sample's
  // latitude has seven decimals in the source).
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export visible CSV', exact: true }).click()
  const csv = await readFile((await (await download).path())!, 'utf8')
  expect(csv).toContain('38.9004769')
  expect(csv).toContain('-76.9993872')
})
