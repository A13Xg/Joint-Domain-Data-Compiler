// Layout regression guards.
//
// The Transform tab used to clip ~1500px of cards with no way to scroll to
// them: `.transform-workspace` had `overflow: hidden`, so it shrank as a flex
// item, hid the remainder, and left `.tab-content` seeing
// scrollHeight === clientHeight — no scrollbar anywhere. The log stream had
// the same `overflow: hidden` bug, which also made its autoscroll a no-op.
//
// Neither failure was visible to any existing assertion, because everything
// still *rendered* — it just rendered where nobody could reach it. These tests
// assert reachability directly.

import { test, expect } from '@playwright/test'
import { join } from 'node:path'

const fixture = join(process.cwd(), 'test', 'fixtures', 'real-usgs.gpx')
const TABS = ['Overview', 'Map', 'Charts', 'Table', 'Points', 'Transform', 'Sources', 'Project', 'Export']

/**
 * Reports content rendered outside what any scroll can reach.
 *
 * An element only counts when nothing between it and `.tab-content` clips or
 * scrolls: a child of an inner scroller (the data grid) or of a deliberate
 * clipper (Leaflet's tile buffer inside `.map-canvas-wrap`) is that
 * container's business, not a page-level overflow.
 */
async function unreachableContent(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const content = document.querySelector('.tab-content')
    if (!content) return { offenders: ['no .tab-content'], horizontal: [] as string[], traps: [] as string[] }
    const contentRect = content.getBoundingClientRect()
    const maxReach = contentRect.top + content.scrollHeight
    const offenders: string[] = []
    const horizontal: string[] = []

    const isContained = (el: Element): boolean => {
      let parent = el.parentElement
      while (parent && parent !== content) {
        const overflow = getComputedStyle(parent)
        if (overflow.overflowY !== 'visible' || overflow.overflowX !== 'visible') return true
        parent = parent.parentElement
      }
      return false
    }

    for (const el of Array.from(content.querySelectorAll('*'))) {
      const rect = el.getBoundingClientRect()
      if (rect.height === 0 && rect.width === 0) continue
      if (isContained(el)) continue
      const label = `${el.tagName}.${String(el.className || '(none)').split(' ')[0]}`
      // 2px of tolerance for sub-pixel rounding in layout.
      if (rect.bottom > maxReach + 2) offenders.push(`${label} bottom=${Math.round(rect.bottom)} reach=${Math.round(maxReach)}`)
      if (rect.right > contentRect.right + 2) horizontal.push(`${label} right=${Math.round(rect.right)} edge=${Math.round(contentRect.right)}`)
    }
    // A container that clips (overflow: hidden/clip) *and* holds more than it
    // shows is a trap: the content exists, is invisible, and no scroll can
    // reach it. This is the exact shape of the original Transform and
    // log-stream bugs, and it is invisible to the bounds check above precisely
    // because the clip keeps the overflow inside the parent's rect.
    const traps: string[] = []
    const candidates: Element[] = [content, ...Array.from(content.querySelectorAll('*'))]
    for (const el of candidates) {
      const style = getComputedStyle(el)
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip'
      if (!clipsY) continue
      if (el.scrollHeight <= el.clientHeight + 2) continue
      // Leaflet positions its tile buffer absolutely and deliberately clips it;
      // the panes carry no scrollable document flow of their own.
      if (el.closest('.leaflet-container')) continue
      const label = `${el.tagName}.${String(el.className || '(none)').split(' ')[0]}`
      traps.push(`${label} hides ${el.scrollHeight - el.clientHeight}px with no scrollbar`)
    }

    return { offenders, horizontal, traps }
  })
}

for (const height of [800, 640]) {
  test(`every tab keeps its content reachable at 1280x${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height })
    await page.goto('/')
    await page.locator('input[type=file][multiple]').first().setInputFiles(fixture)
    await expect(page.getByText('1 dataset loaded')).toBeVisible()

    for (const tab of TABS) {
      const button = page.locator('.tab-bar').getByRole('button', { name: tab, exact: true })
      if (await button.count() === 0 || await button.isDisabled()) continue
      await button.click()
      // Let the map/chart settle; both size themselves from the container.
      await page.waitForTimeout(300)

      const { offenders, horizontal, traps } = await unreachableContent(page)
      expect(offenders, `${tab} @${height} renders content past the scrollable extent`).toEqual([])
      expect(horizontal, `${tab} @${height} overflows horizontally`).toEqual([])
      expect(traps, `${tab} @${height} clips content inside a container that cannot scroll`).toEqual([])

      const bodyOverflow = await page.evaluate(() => document.body.scrollWidth - document.body.clientWidth)
      expect(bodyOverflow, `${tab} @${height} makes the page scroll sideways`).toBeLessThanOrEqual(1)
    }
  })
}

test('the Transform tab scrolls to its last card group', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.locator('input[type=file][multiple]').first().setInputFiles(fixture)
  await page.locator('.tab-bar').getByRole('button', { name: 'Transform', exact: true }).click()

  // Every tab but Import is code-split, so the panel arrives after the click.
  // Measuring before it does reads the loading skeleton, whose scroll height
  // legitimately equals its client height -- a race that fails this assertion
  // for the one reason it is not testing.
  await expect(page.locator('.op-card').first()).toBeVisible()

  const content = page.locator('.tab-content')
  const metrics = await content.evaluate((el) => ({ clientH: el.clientHeight, scrollH: el.scrollHeight }))
  // The tab is taller than the viewport by design — that is precisely why it
  // must be scrollable rather than clipped.
  expect(metrics.scrollH).toBeGreaterThan(metrics.clientH)

  const derive = page.locator('.op-group').filter({ hasText: 'Derive' }).first()
  await derive.scrollIntoViewIfNeeded()
  await expect(derive.getByRole('button', { name: 'Apply' }).first()).toBeInViewport()

  // The last control in the tab must be clickable, not merely present.
  const offsetCard = page.locator('.op-card').filter({ hasText: 'Offset elevation' })
  await offsetCard.scrollIntoViewIfNeeded()
  await expect(offsetCard.getByRole('button', { name: 'Apply' })).toBeInViewport()
})

test('the log dock starts collapsed, shows the newest line, and expands', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  // Bundled map overlays load in the background and log when they arrive. If
  // that lands after the import, the newest line is the overlay's, not the
  // import's -- so wait for it here rather than racing it below.
  await expect(page.locator('.log-collapsed-bar .log-msg')).toContainText('overlay')

  await page.locator('input[type=file][multiple]').first().setInputFiles(fixture)
  await expect(page.getByText('1 dataset loaded')).toBeVisible()

  // Collapsed by default, and genuinely one line rather than a full-height
  // dock with its contents hidden.
  const bar = page.locator('.log-collapsed-bar')
  await expect(bar).toBeVisible()
  const collapsedHeight = await page.locator('.log-dock').evaluate((el) => el.clientHeight)
  expect(collapsedHeight).toBeLessThan(48)

  // The newest entry is what a single visible line must show.
  await expect(bar.locator('.log-msg')).toContainText('real-usgs.gpx')
  const collapsedTabHeight = await page.locator('.tab-content').evaluate((el) => el.clientHeight)

  await page.locator('.log-collapse').click()
  await expect(page.locator('.log-stream')).toBeVisible()
  const expandedHeight = await page.locator('.log-dock').evaluate((el) => el.clientHeight)
  expect(expandedHeight).toBeGreaterThan(collapsedHeight)

  // Collapsing must hand the height back to the workspace, not just hide text.
  const expandedTabHeight = await page.locator('.tab-content').evaluate((el) => el.clientHeight)
  expect(collapsedTabHeight).toBeGreaterThan(expandedTabHeight)

  // The stream scrolls and autoscroll actually reaches the bottom. Both were
  // impossible while .log-stream was overflow: hidden.
  const stream = await page.locator('.log-stream').evaluate((el) => ({
    overflowY: getComputedStyle(el).overflowY,
    atBottom: Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 4,
  }))
  expect(stream.overflowY).toBe('auto')
  expect(stream.atBottom).toBe(true)

  await page.locator('.log-collapse').click()
  await expect(page.locator('.log-collapsed-bar')).toBeVisible()
})

test('the collapsed log line truncates instead of overflowing on a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto('/')
  await page.locator('input[type=file][multiple]').first().setInputFiles(fixture)
  await expect(page.locator('.log-collapsed-bar')).toBeVisible()

  const overflow = await page.locator('.log-collapsed-bar').evaluate((el) => ({
    horizontal: el.scrollWidth - el.clientWidth,
    height: el.clientHeight,
  }))
  expect(overflow.horizontal).toBeLessThanOrEqual(1)
  // Still a single line: a wrapped message would double the bar's height.
  expect(overflow.height).toBeLessThan(48)
})
