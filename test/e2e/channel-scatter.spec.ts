import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'

const fixture = resolve('test/fixtures/real-usgs.gpx')

test('channel-vs-channel scatter: x-axis channel option only appears on Scatter, and plots real points', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file][multiple]').first().setInputFiles(fixture)
  await page.getByRole('button', { name: 'Transform', exact: true }).click()
  // Derive kinematics so the dataset has a second numeric channel (speed) beyond elevation.
  await page.locator('.op-card').filter({ hasText: 'Derive kinematics' }).getByRole('button', { name: 'Apply' }).click()

  await page.getByRole('button', { name: 'Charts', exact: true }).click()
  const xAxisSelect = page.locator('.chart-xaxis select').nth(1)

  await expect(xAxisSelect.locator('option', { hasText: '(channel)' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Scatter chart', exact: true }).click()
  const channelOptionCount = await xAxisSelect.locator('option', { hasText: '(channel)' }).count()
  expect(channelOptionCount).toBeGreaterThan(0)

  await xAxisSelect.selectOption({ label: 'ground_speed_mps (channel)' })
  await expect(page.locator('.chart-time-range')).toContainText('ground_speed_mps range')
  await expect(page.locator('.chart-line')).toHaveCount(0)
  await expect(page.locator('.chart-point').first()).toBeVisible()

  // Switching away from Scatter must fall back off the channel axis rather than
  // drawing a line through non-monotonic channel values.
  await page.getByRole('button', { name: 'Time Series chart', exact: true }).click()
  await expect(page.locator('.chart-line').first()).toBeVisible()
  await expect(page.locator('.chart-time-range')).not.toContainText('ground_speed_mps range')
})
