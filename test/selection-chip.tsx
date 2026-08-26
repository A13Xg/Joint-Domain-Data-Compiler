// The selection badge's contract: the body takes you to the samples it names
// and never discards them, and only the × clears the selection. The badge used
// to be one button that cleared on any click, so this pins the separation
// rather than just the rendering.
import { parseHTML } from 'linkedom'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactElement } from 'react'
import { SelectionChip } from '../src/ui/SelectionChip.tsx'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
;(globalThis as unknown as { window: unknown }).window = window
;(globalThis as unknown as { document: unknown }).document = window.document
;(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = window.HTMLElement
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function render(node: ReactElement) {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  flushSync(() => { createRoot(container as unknown as Element).render(node) })
  return container
}

console.log('the body jumps, the × clears')
{
  let jumped = 0
  let cleared = 0
  const container = render(
    <SelectionChip label="selected #412" onJump={() => { jumped++ }} jumpTitle="Centre the map on this point" onClear={() => { cleared++ }} clearLabel="Clear point selection" />,
  )

  const jump = container.querySelector('.selection-chip-jump') as HTMLElement
  const clear = container.querySelector('.selection-chip-clear') as HTMLElement
  check('the badge names the selection', jump.textContent === 'selected #412')
  check('the clear control is a separate labelled button', clear.getAttribute('aria-label') === 'Clear point selection')
  check('the clear control is not nested inside the jump', !jump.contains(clear))

  flushSync(() => { jump.click() })
  check('clicking the body jumps', jumped === 1, `jumped=${jumped}`)
  check('clicking the body does not clear', cleared === 0, `cleared=${cleared}`)

  flushSync(() => { clear.click() })
  check('clicking the × clears', cleared === 1, `cleared=${cleared}`)
  check('clicking the × does not jump', jumped === 1, `jumped=${jumped}`)
}

console.log('without a jump target')
{
  let cleared = 0
  const container = render(<SelectionChip label="12:00 → 12:05" tone="range" onClear={() => { cleared++ }} clearLabel="Clear time range selection" />)
  check('the body is not a button when there is nowhere to go', container.querySelector('.selection-chip-jump') === null)
  check('the label is still shown', container.querySelector('.selection-chip-label')?.textContent === '12:00 → 12:05')
  check('the badge exposes exactly one control', container.querySelectorAll('button').length === 1)

  flushSync(() => { (container.querySelector('.selection-chip-clear') as HTMLElement).click() })
  check('the × still clears', cleared === 1)
}

console.log('tone')
{
  const point = render(<SelectionChip label="selected #1" onClear={() => {}} clearLabel="Clear point selection" />)
  check('a point selection reads as active', point.querySelector('.selection-chip')?.className.includes('chip-on') === true)
  const range = render(<SelectionChip label="range 1–9" tone="range" onClear={() => {}} clearLabel="Clear range selection" />)
  check('a range selection reads as a span', range.querySelector('.selection-chip')?.className.includes('chip-range') === true)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll selection-chip checks passed.')
