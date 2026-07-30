import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { resolve } from 'node:path'

const fixture = resolve('file-test/real-usgs.gpx')
const csvFixture = resolve('file-test/real-usgs.csv')
const comparisonFixtureA = resolve('file-test/comparison-a.csv')
const comparisonFixtureB = resolve('file-test/comparison-b.csv')

async function importCsvDataset(page: import('@playwright/test').Page, file: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(file)
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeEnabled()
}

test('comparison workflow aligns two imported CSV datasets', async ({ page }) => {
  await page.goto('/')
  await importCsvDataset(page, comparisonFixtureA)
  await importCsvDataset(page, comparisonFixtureB)
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await page.getByLabel('tolerance (ms)').fill('86400000')
  await expect(page.getByText('aligned samples', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export comparison CSV', exact: true })).toBeVisible()
})

test('fusion workflow creates a derived dataset without altering sources', async ({ page }) => {
  await page.goto('/')
  await importCsvDataset(page, comparisonFixtureA)
  await importCsvDataset(page, comparisonFixtureB)
  await page.getByRole('button', { name: 'Fusion', exact: true }).click()
  await page.getByLabel('Include comparison-a.csv as a fusion source').check()
  await page.getByLabel('Include comparison-b.csv as a fusion source').check()
  await page.getByLabel('time tolerance (ms)').fill('86400000')
  await page.getByRole('button', { name: 'Run Auto-Combine', exact: true }).click()
  await expect(page.locator('pre.fusion-report').first()).toBeVisible()
  await expect(page.getByRole('table', { name: /Fusion decision timeline/ })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'timestamp' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'override' })).toBeVisible()
  await expect(page.locator('.dataset-list').getByText(/Fused_/)).toBeVisible()
  await expect(page.locator('.dataset-list').getByText('comparison-a.csv', { exact: true })).toBeVisible()
  await expect(page.locator('.dataset-list').getByText('comparison-b.csv', { exact: true })).toBeVisible()
  await expect(page.getByText(/Created Fused_/)).toBeVisible()
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  const projectDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save complete project' }).click()
  const projectPath = await (await projectDownload).path()
  expect(projectPath).not.toBeNull()
  const projectBytes = await readFile(projectPath!)
  const projectJson = JSON.parse(gunzipSync(projectBytes).toString('utf8'))
  expect(projectJson.manifest.schemaVersion).toBe(2)
  expect(projectJson.manifest.fusionArtifacts).toHaveLength(1)
  expect(projectJson.manifest.fusionArtifacts[0].sourceRegistrations).toHaveLength(2)
  await page.getByRole('button', { name: 'Fusion', exact: true }).click()
  await expect(page.getByRole('table', { name: /Fusion decision timeline/ })).toBeVisible()
})

test('verified transform history replays from its retained source snapshot', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file][multiple]').first().setInputFiles(fixture)
  await page.getByRole('button', { name: 'Transform', exact: true }).click()
  const elevationOffsetCard = page.locator('.op-card').filter({ hasText: 'Offset elevation' })
  await elevationOffsetCard.getByRole('spinbutton', { name: 'meters' }).fill('10')
  await elevationOffsetCard.getByRole('button', { name: 'Apply' }).click()
  await page.getByRole('button', { name: 'Replay verified history', exact: true }).click()
  await expect(page.locator('.toast').getByText('Replayed 1 verified operation(s)')).toBeVisible()
  await expect(page.getByText('Operation history (1)')).toBeVisible()
})

test('named recipes can be captured, replayed, deleted, and persisted', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file][multiple]').first().setInputFiles(fixture)
  await page.getByRole('button', { name: 'Transform', exact: true }).click()
  const elevationOffsetCard = page.locator('.op-card').filter({ hasText: 'Offset elevation' })
  await elevationOffsetCard.getByRole('spinbutton', { name: 'meters' }).fill('10')
  await elevationOffsetCard.getByRole('button', { name: 'Apply' }).click()
  await page.getByLabel('Recipe name').fill('Ten meter offset')
  await page.getByRole('button', { name: 'Save named recipe', exact: true }).click()
  await expect(page.getByText('Named recipes (1)')).toBeVisible()
  await page.getByRole('button', { name: 'Replay', exact: true }).click()
  await expect(page.locator('.toast').getByText('Replayed recipe “Ten meter offset”')).toBeVisible()

  await page.getByRole('button', { name: 'Project', exact: true }).click()
  const projectDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save complete project' }).click()
  const projectPath = await (await projectDownload).path()
  expect(projectPath).not.toBeNull()
  const projectJson = JSON.parse(gunzipSync(await readFile(projectPath!)).toString('utf8'))
  expect(projectJson.manifest.recipes).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Ten meter offset' })]))

  await page.getByRole('button', { name: 'Transform', exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Named recipes (1)')).toHaveCount(0)
})

test('CSV mapping workflow previews and builds an immutable dataset', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(csvFixture)
  await expect(page.getByRole('button', { name: 'CSV Mapping', exact: true })).toBeVisible()
  await expect(page.getByText(/Preview first \d+ physical rows/i)).toBeVisible()
  await expect(page.getByLabel(/Data begins after row/i)).toBeVisible()
  await expect(page.getByText(/Why row 1 (looks|does not look) like a header \((high|medium|low|ambiguous) confidence\)/i)).toBeVisible()
  await page.getByText(/Why row 1 (looks|does not look) like a header/i).click()
  await expect(page.getByText(/independent of/i)).toBeVisible()
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeEnabled()
  await expect(page.getByText(/sha256:/)).toBeVisible()
})

test('browser build discloses the desktop-only persistent KML/KMZ overlay capability', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file][multiple]').first().setInputFiles(fixture)
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(page.getByText('Persistent KML/KMZ library storage is available in the Electron desktop app.')).toBeVisible()
  await expect(page.getByText('import KML files directly from the Import tab.')).toBeVisible()
})

test('primary local-first workflow: import, inspect, transform, save/open, and export', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Joint Domain Data Compiler' })).toBeVisible()
  await expect(page.getByText('0 datasets loaded')).toBeVisible()

  const dataInput = page.locator('input[type=file][multiple]').first()
  await dataInput.setInputFiles(fixture)
  await expect(page.getByText('real-usgs.gpx', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('1 dataset loaded')).toBeVisible()
  await expect(page.getByText('8', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/sha256:/)).toBeVisible()
  await expect(page.locator('.workspace')).toHaveScreenshot('imported-workspace.png', { animations: 'disabled', caret: 'hide', maxDiffPixels: 20 })

  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.getByText('8 / 8 rows')).toBeVisible()
  await page.locator('.grid-row').nth(2).click()
  await expect(page.getByRole('button', { name: 'selected #2 ×' })).toBeVisible()

  await page.getByRole('button', { name: 'Charts', exact: true }).click()
  await expect(page.getByRole('button', { name: 'point #2 ×' })).toBeVisible()

  await expect(page.getByRole('navigation').getByRole('button', { name: /kml/i })).toHaveCount(0)

  await page.getByRole('button', { name: 'Map', exact: true }).click()
  await expect(page.getByRole('button', { name: 'selected #2 ×' })).toBeVisible()
  const overlaysToggle = page.getByRole('button', { name: /^Overlays/ })
  await expect(overlaysToggle).toBeVisible()
  await overlaysToggle.click()
  await expect(page.getByRole('region', { name: 'Map overlay manager' })).toBeVisible()
  await overlaysToggle.click()

  await page.getByRole('button', { name: '3D', exact: true }).click()
  await expect(page.getByLabel('Interactive local ENU trajectory scene')).toBeVisible()
  await expect(page.getByRole('button', { name: 'selected #2 ×' })).toBeVisible()

  await page.getByRole('button', { name: 'Transform', exact: true }).click()
  const elevationOffsetCard = page.locator('.op-card').filter({ hasText: 'Offset elevation' })
  await elevationOffsetCard.getByRole('spinbutton', { name: 'meters' }).fill('10')
  await elevationOffsetCard.getByRole('button', { name: 'Apply' }).click()
  const deriveCard = page.locator('.op-card').filter({ hasText: 'Derive kinematics' })
  await deriveCard.getByRole('button', { name: 'Apply' }).click()
  await page.getByText('Operation history (2)').click()
  await expect(page.locator('.operation-history').getByText(/Offset elevation by 10/)).toBeVisible()
  await expect(page.locator('.operation-history').getByText(/Derived standard kinematics/)).toBeVisible()
  await expect(page.locator('.operation-history').getByText(/not replayable/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Replay verified history', exact: true }).click()
  await expect(page.locator('.toast').getByText('Replayed 2 verified operation(s)')).toBeVisible()

  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await page.getByLabel('Toggle visibility of real-usgs.gpx').uncheck()

  await page.getByRole('button', { name: 'Project', exact: true }).click()
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await page.getByRole('textbox', { name: 'project name' }).fill('browser-smoke')
  const projectDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save complete project' }).click()
  const project = await projectDownload
  expect(project.suggestedFilename()).toBe('browser-smoke.jddc-project')
  const projectPath = await project.path()
  expect(projectPath).not.toBeNull()
  await expect(page.getByText(/Saved 1 dataset/)).toBeVisible()
  await expect(page.getByText('Unsaved changes')).toHaveCount(0)

  const projectInput = page.locator('input[type=file][accept*=".jddc-project"]')
  await projectInput.setInputFiles(projectPath!)
  await expect(page.getByText(/Restored 1 dataset/)).toBeVisible()

  await page.getByRole('button', { name: 'Project', exact: true }).click()
  await page.getByRole('button', { name: 'Export HTML report' }).click()
  const reportDialog = page.getByRole('dialog', { name: 'Export HTML report' })
  await expect(reportDialog).toBeVisible()
  await expect(reportDialog.getByLabel('Report title')).toHaveValue(/browser-smoke.*\d{4}-\d{2}-\d{2}/)
  await expect(reportDialog.getByLabel('Download filename')).toHaveValue(/browser-smoke-report/)
  const checklist = reportDialog.locator('.dialog-checklist')
  await expect(checklist).toBeVisible()
  await checklist.locator('summary').click()
  await expect(checklist).toHaveAttribute('open', '')
  await expect(checklist.getByText('Import/parser warnings')).toBeVisible()

  // Cancel triggers no download.
  let cancelDownloadFired = false
  const onCancelDownload = () => { cancelDownloadFired = true }
  page.on('download', onCancelDownload)
  await reportDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(reportDialog).toHaveCount(0)
  expect(cancelDownloadFired).toBe(false)
  page.off('download', onCancelDownload)

  await page.getByRole('button', { name: 'Export HTML report' }).click()
  const reopenedDialog = page.getByRole('dialog', { name: 'Export HTML report' })
  await reopenedDialog.locator('.dialog-checklist summary').click()
  await reopenedDialog.getByLabel('Report title').fill('Browser evidence report')
  await reopenedDialog.getByLabel('Download filename').fill('browser-evidence')
  await reopenedDialog.getByLabel('Import/parser warnings').uncheck()

  // Task 3.3: "Remember these settings" defaults unchecked, and leaving it
  // unchecked must not persist this session's checklist choice.
  await expect(reopenedDialog.getByLabel('Remember these settings for this project')).not.toBeChecked()
  const reportDownload = page.waitForEvent('download')
  await reopenedDialog.getByRole('button', { name: 'Generate report' }).click()
  const report = await reportDownload
  expect(report.suggestedFilename()).toBe('browser-evidence.html')
  const reportPath = await report.path()
  expect(reportPath).not.toBeNull()
  const reportHtml = await readFile(reportPath!, 'utf8')
  expect(reportHtml).toContain('real-usgs.gpx')
  expect(reportHtml).toContain('Browser evidence report')
  expect(reportHtml).toContain('Import/parser warnings')
  const notIncludedBlock = reportHtml.split('Not included')[1] ?? ''
  expect(notIncludedBlock).toContain('Import/parser warnings')
  expect(reportHtml).not.toContain('<h3>Import warnings</h3>')
  expect(reportHtml).toContain('Derived standard kinematics')
  expect(reportHtml).toContain('@media print')

  // Reopening after an unchecked "remember" export must prefill from
  // DEFAULT_REPORT_OPTIONS as before (Import/parser warnings back on) —
  // this session's unchecked-box choice was not carried over.
  await page.getByRole('button', { name: 'Export HTML report' }).click()
  const thirdDialog = page.getByRole('dialog', { name: 'Export HTML report' })
  await thirdDialog.locator('.dialog-checklist summary').click()
  await expect(thirdDialog.getByLabel('Import/parser warnings')).toBeChecked()

  // Now opt in: uncheck a section and check "remember" before confirming.
  await thirdDialog.getByLabel('Import/parser warnings').uncheck()
  await thirdDialog.getByLabel('Remember these settings for this project').check()
  const rememberedDownload = page.waitForEvent('download')
  await thirdDialog.getByRole('button', { name: 'Generate report' }).click()
  await rememberedDownload

  // The next dialog open must prefill the checklist from the remembered
  // preferences (Import/parser warnings now off by default), not
  // DEFAULT_REPORT_OPTIONS, and the remember checkbox itself resets to
  // unchecked rather than staying sticky.
  await page.getByRole('button', { name: 'Export HTML report' }).click()
  const fourthDialog = page.getByRole('dialog', { name: 'Export HTML report' })
  await fourthDialog.locator('.dialog-checklist summary').click()
  await expect(fourthDialog.getByLabel('Import/parser warnings')).not.toBeChecked()
  await expect(fourthDialog.getByLabel('Remember these settings for this project')).not.toBeChecked()
  await fourthDialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await expect(page.getByLabel('Toggle visibility of real-usgs.gpx')).not.toBeChecked()
  await page.getByRole('button', { name: 'Project', exact: true }).click()

  await page.getByPlaceholder('Describe what happened and how to reproduce it.').fill('Browser smoke diagnostic')
  const diagnosticDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export diagnostic bundle' }).click()
  const diagnostic = await diagnosticDownload
  expect(diagnostic.suggestedFilename()).toMatch(/^jddc-diagnostics-\d{4}-\d{2}-\d{2}\.json$/)
  const diagnosticPath = await diagnostic.path()
  expect(diagnosticPath).not.toBeNull()
  const diagnosticJson = JSON.parse(await readFile(diagnosticPath!, 'utf8'))
  expect(diagnosticJson.schemaVersion).toBe(1)
  expect(diagnosticJson.userNote).toBe('Browser smoke diagnostic')
  expect(diagnosticJson.datasets).toEqual([
    expect.objectContaining({ name: 'real-usgs.gpx', sourceFormat: 'gpx', pointCount: 8 }),
  ])
  expect(diagnosticJson.datasets[0]).not.toHaveProperty('points')

  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.getByRole('button', { name: 'selected #2 ×' })).toBeVisible()

  await page.getByRole('navigation').getByRole('button', { name: 'Export', exact: true }).click()
  const exportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export 8 points' }).click()
  const exported = await exportDownload
  expect(exported.suggestedFilename()).toBe('real-usgs.gpx')

  expect(pageErrors).toEqual([])
})
