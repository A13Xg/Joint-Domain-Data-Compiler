import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

test('declaring references is recorded, shown, and undoable', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(resolve('test/fixtures/demo-flight-a.csv'))
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  const metadataRow = (label: string) => page.locator('.track-metrics tr').filter({ hasText: label })
  await page.getByRole('button', { name: 'Overview', exact: true }).click()
  await expect(metadataRow('altitude reference')).toContainText('UNKNOWN')

  await page.getByRole('button', { name: 'Transform', exact: true }).click()
  const card = page.locator('.op-card').filter({ hasText: 'Declare references' })
  await card.getByLabel('altitude reference').selectOption('MSL')
  await card.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.toast').filter({ hasText: 'Declared altitude reference UNKNOWN → MSL' })).toBeVisible()

  await page.getByRole('button', { name: 'Overview', exact: true }).click()
  await expect(metadataRow('altitude reference')).toContainText('MSL')

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(metadataRow('altitude reference')).toContainText('UNKNOWN')
})

// Declaring once has to last: dataset fingerprints ignore metadata, so a restore
// that rebuilt metadata from the points would revert MSL to UNKNOWN and still
// pass its integrity check.
test('a declared reference survives save and reopen', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(resolve('test/fixtures/demo-flight-a.csv'))
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Transform', exact: true }).click()
  const card = page.locator('.op-card').filter({ hasText: 'Declare references' })
  await card.getByLabel('altitude reference').selectOption('MSL')
  await card.getByLabel('time reference').selectOption('GPS')
  await card.getByRole('button', { name: 'Apply' }).click()

  await page.getByRole('button', { name: 'Project', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save complete project' }).click()
  const projectPath = await (await download).path()
  await page.locator('input[type=file][accept*=".jddc-project"]').setInputFiles(projectPath!)
  await expect(page.getByText(/Restored 1 dataset/)).toBeVisible()

  await page.getByRole('button', { name: 'Overview', exact: true }).click()
  const metadataRow = (label: string) => page.locator('.track-metrics tr').filter({ hasText: label })
  await expect(metadataRow('altitude reference')).toContainText('MSL')
  await expect(metadataRow('time reference')).toContainText('GPS')
  await page.getByRole('button', { name: 'Transform', exact: true }).click()
  await expect(page.locator('.transform-workspace')).toContainText('Declared altitude reference UNKNOWN → MSL')
})
