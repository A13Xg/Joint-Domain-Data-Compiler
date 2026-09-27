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
  await expect(page.locator('.map-toolbar .selection-chip')).toHaveCount(0)
})

test('in measure mode, clicking a sample snaps to it once and does not select it', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(resolve('test/fixtures/demo-flight-a.csv'))
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await page.getByLabel('basemap').selectOption('none')
  await page.getByLabel('display').selectOption('points')
  await page.getByRole('button', { name: 'Fit active', exact: true }).click()
  await page.getByRole('button', { name: 'Measure', exact: true }).click()
  await page.waitForTimeout(1200) // let the fit animation and the panel's re-layout settle

  // Sample markers are the small filled circles in the marker pane.
  const sample = page.locator('.leaflet-overlay-pane path.leaflet-interactive[fill-opacity="0.75"]').nth(200)
  const box = (await sample.boundingBox())!
  // Off-centre on purpose: a vertex at the pointer would then differ from one snapped to the sample.
  const pointer = { x: box.x + box.width / 2 + 2, y: box.y + box.height / 2 + 1.5 }
  // Samples overlap at this zoom, so the one actually under the pointer may be a
  // neighbour; the vertex must land on THAT sample's centre.
  const centre = await page.evaluate(({ x, y }) => { const r = document.elementFromPoint(x, y)!.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, pointer)
  await page.mouse.click(pointer.x, pointer.y)

  // One vertex: the sample's click must not also fall through to the map's.
  await expect(page.locator('.measure-vertex-label')).toHaveCount(1)
  await expect(page.locator('.map-toolbar .selection-chip')).toHaveCount(0)
  // The vertex sits on the sample, not merely where the pointer was.
  const vertex = page.locator('.leaflet-overlay-pane path[stroke="#0f172a"][fill="#f8fafc"]')
  const vbox = (await vertex.boundingBox())!
  expect(Math.abs(vbox.x + vbox.width / 2 - centre.x)).toBeLessThan(1.5)
  expect(Math.abs(vbox.y + vbox.height / 2 - centre.y)).toBeLessThan(1.5)
  expect(Math.hypot(vbox.x + vbox.width / 2 - pointer.x, vbox.y + vbox.height / 2 - pointer.y)).toBeGreaterThan(1.5)
})

// The hover cursor is drawn on top of the hovered sample; while it was an
// interactive layer it swallowed the click, so a sample could not be selected
// on the map at all.
test('clicking a sample on the map selects it', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(resolve('test/fixtures/demo-flight-a.csv'))
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await page.getByLabel('basemap').selectOption('none')
  await page.getByLabel('display').selectOption('points')
  await page.getByRole('button', { name: 'Fit active', exact: true }).click()
  await page.waitForTimeout(1200)
  const sample = page.locator('.leaflet-overlay-pane path.leaflet-interactive[fill-opacity="0.75"]').nth(300)
  const box = (await sample.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.map-toolbar .selection-chip')).toContainText(/selected #\d+/)
})
