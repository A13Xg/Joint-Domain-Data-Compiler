import { test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Capture tool, not an assertion suite. It regenerates every screenshot in
// public/user-guide.html against the real app, so a UI change can be reflected
// in the guide by re-running one command rather than by hand-editing images:
//
//   npm run guide:screenshots
//
// Deliberately excluded from `check:e2e` and `check:all` -- it asserts almost
// nothing and writes into the repo, which is not what a gate should do.
//
// Determinism matters here in a way it does not for a normal spec: the output
// is committed. Fixed viewport, fixed synthetic fixtures, and the offline
// basemap (see below) mean a re-run reproduces the same pictures.

const OUTPUT_DIR = resolve('public/user-guide')
const flightA = resolve('test/fixtures/demo-flight-a.csv')
const flightB = resolve('test/fixtures/demo-flight-b.csv')
const outlierTrack = resolve('test/fixtures/outlier-spikes.csv')

// Wide enough that the full tab bar, through Settings, is never clipped.
test.use({ viewport: { width: 1600, height: 1000 } })

async function shoot(page: Page, name: string): Promise<void> {
  await settle(page)
  await page.screenshot({ path: `${OUTPUT_DIR}/${name}.png` })
}

/**
 * Wait out transitions and, crucially, the toast stack: an import toast sitting
 * over the bottom-right corner would be baked into a guide screenshot that is
 * meant to show the panel underneath it.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(250)
  await page.locator('.toast').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
}

/** Screenshot one panel rather than the whole window, for close-ups. */
async function shootElement(page: Page, selector: string, name: string): Promise<void> {
  await settle(page)
  await page.locator(selector).first().screenshot({ path: `${OUTPUT_DIR}/${name}.png` })
}

async function importCsv(page: Page, file: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(file)
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Overview', exact: true }).waitFor({ state: 'attached' })
}

async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click()
}

test('capture user guide screenshots', async ({ page }) => {
  test.setTimeout(300_000)
  mkdirSync(OUTPUT_DIR, { recursive: true })

  await page.goto('/')
  await shoot(page, '01-app-shell')

  // --- import and CSV mapping ------------------------------------------------
  await page.locator('input[type="file"]').setInputFiles(flightA)
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).waitFor()
  await shoot(page, '02-csv-mapping')
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Overview', exact: true }).waitFor({ state: 'attached' })
  await importCsv(page, flightB)

  // --- overview --------------------------------------------------------------
  await openTab(page, 'Overview')
  await page.locator('.health-score-badge').waitFor()
  await shoot(page, '03-overview')
  await shootElement(page, '.track-health-panel', '04-track-health')
  await shootElement(page, '.track-metrics', '05-track-metrics')

  // --- map -------------------------------------------------------------------
  await openTab(page, 'Map')
  await page.locator('.map-canvas-wrap').waitFor()
  // The offline grid, not a tile basemap: keeps the capture independent of the
  // network and keeps third-party map imagery out of a shipped, redistributed
  // document.
  await page.getByLabel('basemap').selectOption('none')
  await page.getByRole('button', { name: /Fit active/i }).click()
  await shoot(page, '06-map')

  // --- charts ----------------------------------------------------------------
  await openTab(page, 'Charts')
  await page.locator('.chart-svg').waitFor()
  await shoot(page, '07-charts')

  // --- table -----------------------------------------------------------------
  await openTab(page, 'Table')
  await page.locator('[role="grid"]').waitFor()
  await shoot(page, '08-table')

  // --- point inspector -------------------------------------------------------
  await openTab(page, 'Points')
  await page.locator('.point-fields').first().waitFor()
  await shoot(page, '09-points')

  // --- compare ---------------------------------------------------------------
  await openTab(page, 'Compare')
  await page.getByText('aligned samples', { exact: true }).waitFor()
  await shoot(page, '10-compare')

  // --- 3D --------------------------------------------------------------------
  await openTab(page, '3D')
  await page.locator('canvas').first().waitFor()
  await page.waitForTimeout(600) // the scene draws on an animation frame
  await shoot(page, '11-scene3d')

  // --- transform -------------------------------------------------------------
  await openTab(page, 'Transform')
  await page.locator('.op-card').first().waitFor()
  await shoot(page, '12-transform')

  // --- export ----------------------------------------------------------------
  await openTab(page, 'Export')
  await page.waitForTimeout(400) // the live preview renders after the panel mounts
  await shoot(page, '13-export')

  // --- project and the report dialog -----------------------------------------
  await openTab(page, 'Project')
  await shoot(page, '14-project')
  await page.getByRole('button', { name: 'Export HTML report', exact: true }).click()
  const checklist = page.locator('details.dialog-checklist')
  if (!(await checklist.evaluate((element: HTMLDetailsElement) => element.open))) {
    await checklist.locator('summary').click()
  }
  await shoot(page, '15-report-dialog')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  // --- fusion, sources, settings ---------------------------------------------
  await openTab(page, 'Fusion')
  await shoot(page, '16-fusion')
  await openTab(page, 'Sources')
  await shoot(page, '17-sources')
  await openTab(page, 'Settings')
  await shoot(page, '18-settings')
})

// A separate pass on a deliberately damaged track: the repair flow only appears
// when the outlier check actually fails, which the healthy demo flight never
// does (by design -- it is the fixture for every other screenshot).
test('capture the repair flow screenshots', async ({ page }) => {
  test.setTimeout(180_000)
  mkdirSync(OUTPUT_DIR, { recursive: true })

  await page.goto('/')
  await importCsv(page, outlierTrack)
  await openTab(page, 'Overview')
  await page.locator('.health-score-badge').waitFor()
  await shootElement(page, '.track-health-panel', '19-track-health-failing')

  await page.locator('.health-check').filter({ hasText: 'Outliers' })
    .getByRole('button', { name: 'Repair flagged points' }).click()
  await page.locator('.dialog-backdrop').waitFor()
  await shoot(page, '20-repair-preview')
  await page.locator('.dialog-backdrop').getByRole('button', { name: 'Revert', exact: true }).click()
})
