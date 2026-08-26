// The density overlay had no browser coverage: binTrack is unit-tested, but
// nothing checked that the Leaflet layer mounts, repaints, and tears down.
// The teardown matters — Leaflet leaves a canvas renderer attached to the map
// after its last path is removed, so a toggle loop would strand one per cycle.

import { test, expect } from '@playwright/test'
import { join } from 'node:path'

const fixture = join(process.cwd(), 'test', 'fixtures', 'real-usgs.gpx')

test('the density overlay toggles on, repaints, and cleans up after itself', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file][multiple]').first().setInputFiles(fixture)
  await expect(page.getByText('1 dataset loaded')).toBeVisible()
  await page.locator('.tab-bar').getByRole('button', { name: 'Map', exact: true }).click()
  await expect(page.locator('.leaflet-container')).toBeVisible()

  const canvasCount = () => page.locator('.leaflet-overlay-pane canvas').count()
  const baseline = await canvasCount()

  const toggle = page.getByRole('checkbox', { name: 'density' })
  await toggle.check()
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(baseline + 1)

  // The cell-size control appears only while the overlay is on.
  const cell = page.getByRole('spinbutton', { name: 'cell' })
  await expect(cell).toBeVisible()

  // Changing the cell size rebuilds the layer; it must swap, not stack.
  await cell.fill('1000')
  await page.waitForTimeout(400)
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(baseline + 1)

  await toggle.uncheck()
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(baseline)

  // Several cycles must not accumulate renderers.
  for (let cycle = 0; cycle < 3; cycle++) {
    await toggle.check()
    await toggle.uncheck()
  }
  await expect(page.locator('.leaflet-overlay-pane canvas')).toHaveCount(baseline)

  // The map itself is still alive after all that.
  await expect(page.locator('.leaflet-container')).toBeVisible()
})
