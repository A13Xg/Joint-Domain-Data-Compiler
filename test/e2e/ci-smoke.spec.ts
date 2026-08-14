import { expect, test } from '@playwright/test'

test('application loads and renders workbench', async ({ page }) => {
  await page.goto('/')

  // Check main UI elements are visible
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toBeVisible()
})

test('file input accepts all supported formats', async ({ page }) => {
  await page.goto('/')

  const fileInput = page.locator('input[type="file"]')
  await expect(fileInput).toHaveAttribute('accept', /csv|gpx|kml|kmz|geojson|json|nmea|gps|log|gpb|bin/)
})

test('can display dataset list and format badges', async ({ page }) => {
  await page.goto('/')

  // Check format badges are displayed
  const badges = page.locator('.format-badges .badge')
  await expect(badges).toHaveCount(8) // CSV, GPX, GeoJSON, KML, NMEA, GPB, EAG, KML Library

  // Check dataset list exists (empty by default)
  await expect(page.locator('.dataset-list')).toBeVisible()
  await expect(page.locator('text=No datasets yet')).toBeVisible()
})
