import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Files dropped anywhere in the window import. Before, only the Import tab's
// zone handled a drop: on any other tab the browser took it and navigated to
// the file, replacing the workbench and the unsaved session with it.

async function dropFile(page: Page, selector: string, name: string, text: string): Promise<void> {
  const transfer = await page.evaluateHandle(({ name, text }) => {
    const data = new DataTransfer()
    data.items.add(new File([text], name, { type: 'text/csv' }))
    return data
  }, { name, text })
  await page.dispatchEvent(selector, 'dragenter', { dataTransfer: transfer })
  await page.dispatchEvent(selector, 'dragover', { dataTransfer: transfer })
  await page.dispatchEvent(selector, 'drop', { dataTransfer: transfer })
}

async function datasetCount(page: Page): Promise<number> {
  return page.locator('.dataset-remove').count()
}

test('a file dropped on another tab imports once and the page stays put', async ({ page }) => {
  const csv = await readFile(resolve('test/fixtures/demo-flight-a.csv'), 'utf8')
  await page.goto('/')
  await dropFile(page, '.dropzone', 'first.csv', csv)
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await expect.poll(() => datasetCount(page)).toBe(1)

  await page.getByRole('button', { name: 'Map', exact: true }).click()
  const url = page.url()
  await dropFile(page, '.tab-content', 'second.csv', csv)
  expect(page.url()).toBe(url)
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await expect.poll(() => datasetCount(page)).toBe(2)
  await expect(page.locator('.window-drop-overlay')).toHaveCount(0)
})

test('the overlay appears only while files are dragged over a non-import tab', async ({ page }) => {
  const csv = await readFile(resolve('test/fixtures/demo-flight-a.csv'), 'utf8')
  await page.goto('/')
  await dropFile(page, '.dropzone', 'first.csv', csv)
  await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
  await page.getByRole('button', { name: 'Map', exact: true }).click()
  const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(['x'], 'x.csv')); return data })
  await page.dispatchEvent('.tab-content', 'dragenter', { dataTransfer: transfer })
  await expect(page.locator('.window-drop-overlay')).toBeVisible()
  await page.dispatchEvent('.tab-content', 'dragleave', { dataTransfer: transfer })
  await expect(page.locator('.window-drop-overlay')).toHaveCount(0)
  // A text drag is not ours.
  const textDrag = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData('text/plain', 'hello'); return data })
  await page.dispatchEvent('.tab-content', 'dragenter', { dataTransfer: textDrag })
  await expect(page.locator('.window-drop-overlay')).toHaveCount(0)
})
