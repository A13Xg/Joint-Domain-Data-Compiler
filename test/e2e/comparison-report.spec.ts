import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const comparisonFixtureA = resolve('test/fixtures/comparison-a.csv')
const comparisonFixtureB = resolve('test/fixtures/comparison-b.csv')

async function importCsvDataset(page: import('@playwright/test').Page, file: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(file)
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeEnabled()
}

/** Export an HTML report with the cross-dataset comparison section enabled, and return its markup. */
async function exportReportHtml(page: import('@playwright/test').Page): Promise<string> {
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  await page.getByRole('button', { name: 'Export report (HTML / PDF)', exact: true }).click()
  // The evidence-section checkboxes live inside a <details>; expand it the way
  // a user would rather than reaching into closed markup.
  const checklist = page.locator('details.dialog-checklist')
  if (!(await checklist.evaluate((element: HTMLDetailsElement) => element.open))) {
    await checklist.locator('summary').click()
  }
  // Off by default, so the section is absent unless the user opts in.
  await page.getByLabel('Cross-dataset comparison analytics').check()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save HTML', exact: true }).click()
  const path = await (await download).path()
  expect(path).not.toBeNull()
  return readFile(path!, 'utf8')
}

// `buildComparisonSection` has always existed in htmlReport.ts, but no caller
// ever passed a `comparison` field -- the section was dead code from the UI's
// side and every exported report claimed comparison results were "not yet
// captured". Only a real export can prove that is no longer true.
test('an exported HTML report carries the cross-dataset comparison section', async ({ page }) => {
  await page.goto('/')
  await importCsvDataset(page, comparisonFixtureA)
  await importCsvDataset(page, comparisonFixtureB)

  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await page.getByLabel('tolerance (ms)').fill('86400000')
  await expect(page.getByText('aligned samples', { exact: true })).toBeVisible()

  const html = await exportReportHtml(page)
  expect(html).toContain('<h2>Cross-dataset comparison</h2>')
  expect(html).not.toContain('not yet captured in report export')
  expect(html).toContain('comparison-a.csv')
  expect(html).toContain('comparison-b.csv')
  expect(html).toContain('Aligned samples')
  // A populated summary, not an empty table of "Unavailable" rows.
  expect(html).toMatch(/Mean range<\/th>\s*<td[^>]*>[\d.,]+ m</)
})

// The report re-derives the comparison from the persisted settings rather than
// reading a live result out of the Comparison tab, so it must populate even
// when that tab was never opened in this session.
test('the comparison section populates without ever opening the Compare tab', async ({ page }) => {
  await page.goto('/')
  await importCsvDataset(page, comparisonFixtureA)
  await importCsvDataset(page, comparisonFixtureB)

  const html = await exportReportHtml(page)
  expect(html).toContain('<h2>Cross-dataset comparison</h2>')
  expect(html).not.toContain('not yet captured in report export')
  expect(html).toContain('comparison-a.csv')
  expect(html).toContain('comparison-b.csv')
})

// Browser "Save PDF": there is no PDF engine to call, so the report opens in its
// own tab with the print dialog up. `window.print` is replaced in every page of
// the context so the test can observe the call without a real dialog blocking.
test('Save PDF in the browser opens the report in a tab and raises the print dialog', async ({ page, context }) => {
  await context.addInitScript(() => {
    window.print = () => { (window as unknown as { __printed: boolean }).__printed = true }
  })
  await page.goto('/')
  await importCsvDataset(page, comparisonFixtureA)
  await importCsvDataset(page, comparisonFixtureB)

  await page.getByRole('button', { name: 'Project', exact: true }).click()
  await page.getByRole('button', { name: 'Export report (HTML / PDF)', exact: true }).click()
  const popup = context.waitForEvent('page')
  await page.getByRole('button', { name: 'Save PDF', exact: true }).click()
  const report = await popup
  await report.waitForLoadState('load')
  expect(report.url()).toMatch(/^blob:/)
  await expect(report).toHaveTitle(/Analysis Report/)
  await expect.poll(() => report.evaluate(() => (window as unknown as { __printed?: boolean }).__printed === true)).toBe(true)
  // The dialog closes and nothing errors in the app.
  await expect(page.getByRole('dialog', { name: 'Export report' })).toHaveCount(0)
  await expect(page.locator('.error-line')).toHaveCount(0)
})
