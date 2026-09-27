import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test('the map has a scale bar, the offline grid draws a labelled graticule, and Measure measures', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(resolve('test/fixtures/demo-flight-a.csv'))
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await page.getByLabel('basemap').selectOption('none')
  await page.getByRole('button', { name: 'Fit active', exact: true }).click()

  await expect(page.locator('.map-scale-bar')).toHaveAttribute('aria-label', /^Scale: [\d,.]+ (m|km)$/)
  await expect(page.locator('.graticule-label-parallel').first()).toContainText(/°N/)
  await expect(page.locator('.graticule-label-meridian').first()).toContainText(/°W/)

  await page.getByRole('button', { name: 'Measure', exact: true }).click()
  const box = (await page.locator('.map-canvas').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3)
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3)
  const panel = page.getByRole('region', { name: 'Measurement' })
  await expect(panel).toContainText(/total [\d.,]+ (m|km)/)
  await expect(panel).toContainText(/A→B .* · (8[5-9]|9[0-5])\.\d°T/) // roughly due east
  await panel.getByRole('button', { name: 'Undo point' }).click()
  await expect(panel).not.toContainText('total')
  await panel.getByRole('button', { name: 'Clear' }).click()
  // Measuring never selects a sample.
  await expect(page.getByText(/^selected #/)).toHaveCount(0)
})
