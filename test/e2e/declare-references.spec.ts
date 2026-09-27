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
