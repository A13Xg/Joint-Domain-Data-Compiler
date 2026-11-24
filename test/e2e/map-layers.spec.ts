import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

// The map's React bindings over Leaflet (src/ui/leaflet/) replaced react-leaflet,
// whose Hippocratic license is incompatible with the project's AGPL-3.0. These
// pin the behaviour the rest of the e2e suite does not look at directly:
// tooltip contents rendered on demand, attribution that follows the basemap,
// and a map that tears down cleanly when its tab is left.
test('map layers: tooltips render their content, attribution follows the basemap, teardown is clean', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto('/')
  await page.locator('input[type=file][multiple]').first().setInputFiles(resolve('test/fixtures/real-usgs.gpx'))
  await expect(page.getByText('1 dataset loaded')).toBeVisible()
  await page.getByRole('button', { name: 'Map', exact: true }).click()

  const basemap = page.getByRole('combobox', { name: 'basemap' })
  await basemap.selectOption('osm')
  const attribution = page.locator('.leaflet-control-attribution')
  await expect(attribution).toContainText('OpenStreetMap contributors')

  // Hovering a sample opens its tooltip, filled with that sample's details.
  // Sample markers are found by their fill: the bundled airspace overlay
  // covers the track and has tooltips of its own.
  // A middle one: the first and last sit under the start and end markers.
  const sample = page.locator('path.leaflet-interactive[fill="#0f8c6f"]').nth(4)
  await expect(sample).toBeAttached()
  const box = await sample.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await expect(page.locator('.leaflet-tooltip .map-tip')).toContainText(/#\d+ · /)

  // Switching basemap swaps the credit rather than keeping the first one.
  await basemap.selectOption('osm-topo')
  await expect(attribution).toContainText('OpenTopoMap')
  await basemap.selectOption('none')
  await expect(attribution).not.toContainText('OpenTopoMap')
  await expect(attribution).not.toContainText('OpenStreetMap contributors')

  // Leaving the tab while the map is fitting its bounds must not touch a removed map.
  await page.getByRole('button', { name: '3D', exact: true }).click()
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await page.waitForTimeout(500)
  expect(pageErrors).toEqual([])
})
