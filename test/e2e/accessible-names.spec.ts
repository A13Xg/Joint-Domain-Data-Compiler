import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

const flightA = resolve('test/fixtures/demo-flight-a.csv')
const flightB = resolve('test/fixtures/demo-flight-b.csv')

// Every tab, walked with two datasets loaded so the views that need a second
// one (Compare, Fusion) actually render their controls.
const TABS = ['Overview', 'Map', 'Charts', 'Table', 'Points', 'Compare', '3D',
  'Transform', 'Project', 'Export', 'Sources', 'Fusion', 'Settings']

/**
 * A control with no accessible name is invisible to a screen reader and
 * unreachable by name in this very test suite. Auditing the live accessibility
 * tree catches what grepping for `aria-label` cannot: a control named by a
 * wrapping `<label>`, by its own text, or by `aria-labelledby` is fine, and one
 * named only by a `placeholder` is not -- a placeholder is not an accessible
 * name and disappears the moment the field has a value.
 */
test('every visible control on every tab has an accessible name', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('/')
  for (const file of [flightA, flightB]) {
    await page.locator('input[type="file"]').setInputFiles(file)
    await page.getByRole('button', { name: 'Build dataset from full CSV', exact: true }).click()
    await page.getByRole('button', { name: 'Overview', exact: true }).waitFor({ state: 'attached' })
  }

  const offenders: Record<string, string[]> = {}
  for (const tab of TABS) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    await page.waitForTimeout(700) // lazy chunk + first paint
    const nameless = await page.evaluate(() => {
      const out: string[] = []
      document.querySelectorAll('main input, main select, main textarea, main button').forEach((element) => {
        const el = element as HTMLElement
        // Hidden controls are exempt, except file inputs, which are hidden by
        // design and still activated programmatically.
        if (el.offsetParent === null && el.getAttribute('type') !== 'file') return
        const id = el.getAttribute('id')
        const named = el.getAttribute('aria-label')?.trim()
          || el.getAttribute('title')?.trim()
          || el.getAttribute('aria-labelledby')
          || (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null)
          || (el.closest('label')?.textContent ?? '').trim()
          || (el.textContent ?? '').trim()
        if (named) return
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''
        out.push(`${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[${el.getAttribute('type')}]` : ''}${cls}`)
      })
      return out
    })
    if (nameless.length > 0) offenders[tab] = nameless
  }
  expect(offenders).toEqual({})
})
