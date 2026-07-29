import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const fixture = resolve('file-test/real-usgs.gpx')

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
  const deriveCard = page.locator('.op-card').filter({ hasText: 'Derive kinematics' })
  await deriveCard.getByRole('button', { name: 'Apply' }).click()
  await page.getByText('Operation history (1)').click()
  await expect(page.locator('.operation-history').getByText(/Derived standard kinematics/)).toBeVisible()

  await page.getByRole('button', { name: 'Sources', exact: true }).click()
  await page.getByLabel('Toggle visibility of real-usgs.gpx').uncheck()

  await page.getByRole('button', { name: 'Project', exact: true }).click()
  await expect(page.getByText('Unsaved changes')).toBeVisible()
  await page.getByPlaceholder(/real-usgs/).fill('browser-smoke')
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
  const reportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export HTML report' }).click()
  const report = await reportDownload
  expect(report.suggestedFilename()).toBe('browser-smoke-report.html')
  const reportPath = await report.path()
  expect(reportPath).not.toBeNull()
  const reportHtml = await readFile(reportPath!, 'utf8')
  expect(reportHtml).toContain('real-usgs.gpx')
  expect(reportHtml).toContain('Derived standard kinematics')
  expect(reportHtml).toContain('@media print')

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
