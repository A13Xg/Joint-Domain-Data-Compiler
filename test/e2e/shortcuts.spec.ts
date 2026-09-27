import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'

async function importCsv(page: Page): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles(resolve('test/fixtures/demo-flight-a.csv'))
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeEnabled()
}

const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

test('Ctrl/⌘+S saves the project from any tab', async ({ page }) => {
  await page.goto('/')
  await importCsv(page)
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.keyboard.press(`${mod}+s`)
  expect((await download).suggestedFilename()).toMatch(/\.jddc-project$/)
  await expect(page.getByRole('button', { name: 'Project', exact: true })).toHaveClass(/active/)
})

test('Ctrl/⌘+Z undoes the last transform, but not while typing in a field', async ({ page }) => {
  await page.goto('/')
  await importCsv(page)
  await page.getByRole('button', { name: 'Transform', exact: true }).click()
  const points = page.locator('.transform-workspace').getByText(/^\d[\d,]* points$/).first()
  const before = await points.textContent()
  await page.locator('.op-card').filter({ hasText: 'Reduce points' }).locator('select').selectOption({ index: 1 }).catch(() => {})
  await page.locator('.op-card').filter({ hasText: 'Reduce points' }).getByRole('button', { name: 'Apply' }).click()
  await page.getByRole('button', { name: 'Accept', exact: true }).click({ timeout: 3000 }).catch(() => {})
  await expect(points).not.toHaveText(before!)

  // In a text field, Ctrl+Z belongs to the field.
  const field = page.getByLabel('Recipe name')
  await expect(field).toBeVisible()
  await field.fill('abc')
  await field.press(`${mod}+z`)
  await expect(points).not.toHaveText(before!)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press(`${mod}+z`)
  await expect(points).toHaveText(before!)
  await page.keyboard.press(`${mod}+y`)
  await expect(points).not.toHaveText(before!)
})

test('F1 opens the user guide', async ({ page, context }) => {
  await page.goto('/')
  // The workbench is lazy-loaded; the shortcut listener exists once it has mounted.
  await expect(page.locator('.dropzone')).toBeVisible()
  const popup = context.waitForEvent('page')
  await page.keyboard.press('F1')
  const guide = await popup
  await guide.waitForLoadState('domcontentloaded')
  expect(guide.url()).toContain('user-guide.html')
})

test('Ctrl/⌘+S saves even while typing in the project notes', async ({ page }) => {
  await page.goto('/')
  await importCsv(page)
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  const notes = page.getByPlaceholder('Purpose, assumptions, provenance, or handoff notes.')
  await notes.fill('checked the second racetrack')
  const download = page.waitForEvent('download')
  await notes.press(`${mod}+s`)
  expect((await download).suggestedFilename()).toMatch(/\.jddc-project$/)
  await expect(notes).toHaveValue('checked the second racetrack')
})
