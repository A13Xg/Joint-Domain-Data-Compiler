import { expect, test } from '@playwright/test'
import { rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

// Browser-map evidence caps at the user's practical 500k ceiling. The map
// retains raw points but renders a fixed visual budget, so larger CSV fixtures
// mainly measure import overhead rather than map activation.
const SIZES = [100_000, 500_000] as const

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

function gpbTrack(pointCount: number): Buffer {
  // GPB v1 header: magic, version, time/elevation flags, empty name/channels,
  // then a compact fixed-width 28-byte record per point.
  const headerSize = 14
  const bytesPerPoint = 28
  const buffer = Buffer.allocUnsafe(headerSize + pointCount * bytesPerPoint)
  buffer.write('GPB1')
  buffer.writeUInt8(1, 4)
  buffer.writeUInt8(0x03, 5)
  buffer.writeUInt16LE(0, 6)
  buffer.writeUInt16LE(0, 8)
  buffer.writeUInt32LE(pointCount, 10)
  const start = 1_700_000_000_000
  for (let index = 0, offset = headerSize; index < pointCount; index += 1, offset += bytesPerPoint) {
    const angle = index * 0.0001
    buffer.writeDoubleLE(34.05 + Math.sin(angle) * 0.2, offset)
    buffer.writeDoubleLE(-118.25 + Math.cos(angle) * 0.2, offset + 8)
    buffer.writeFloatLE(100 + index * 0.001, offset + 16)
    buffer.writeDoubleLE(start + index * 1000, offset + 20)
  }
  return buffer
}

for (const pointCount of SIZES) {
  test(`offline map renders a ${pointCount.toLocaleString()} point dataset within the render budget`, async ({ page }) => {
    page.on('pageerror', (error) => console.log(`MAP_PAGE_ERROR ${pointCount} ${error.stack ?? error.message}`))
    await page.goto('/')
    const temporaryPath = resolve(tmpdir(), `jddc-map-performance-${process.pid}-${pointCount}.gpb`)
    try {
      await writeFile(temporaryPath, gpbTrack(pointCount))
      await page.locator('input[type="file"]').setInputFiles(temporaryPath)
    } finally {
      await rm(temporaryPath, { force: true })
    }
    await expect(page.getByRole('button', { name: 'Map', exact: true })).toBeEnabled({ timeout: 120_000 })

    const start = performance.now()
    await page.getByRole('button', { name: 'Map', exact: true }).click()
    await page.getByLabel('basemap').selectOption('none')
    await expect(page.locator('.map-meta')).toContainText(`${pointCount.toLocaleString()} valid pts`)
    const meta = await page.locator('.map-meta').textContent()
    const renderedCount = Number(meta?.match(/([\d,]+) drawn/)?.[1].replaceAll(',', ''))
    expect(renderedCount).toBeLessThanOrEqual(4_000)
    const elapsed = performance.now() - start

    console.log(`MAP_RENDER_MS ${pointCount} ${elapsed.toFixed(0)}`)
    expect(elapsed).toBeLessThan(15_000)
  })
}
