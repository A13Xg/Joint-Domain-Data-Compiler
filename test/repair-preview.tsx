// Verifies the Accept/Revert gate in front of a proposed repair: that it draws
// both tracks, states the counts, offers only the views the diff supports, and
// — the property the whole design rests on — that every way of leaving it
// except Accept leaves the track untouched.
import { parseHTML } from 'linkedom'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactElement } from 'react'
import type { TrackPoint } from '../src/core/model.ts'
import { computeTrackDiff } from '../src/core/repair/diff.ts'
import { RepairPreviewDialog, type RepairPreviewRequest } from '../src/ui/RepairPreviewDialog.tsx'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
;(globalThis as unknown as { window: unknown }).window = window
;(globalThis as unknown as { document: unknown }).document = window.document
// The dialogs restore focus with an `instanceof HTMLElement` guard, which is a
// bare global in a browser but only a window property under linkedom.
;(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = window.HTMLElement

// linkedom's focus() does not move document.activeElement, so the elements the
// dialog chooses to focus are recorded here instead.
const focused: unknown[] = []
const nativeFocus = window.HTMLElement.prototype.focus
window.HTMLElement.prototype.focus = function focus(...args: unknown[]) {
  focused.push(this)
  return (nativeFocus as ((...rest: unknown[]) => unknown) | undefined)?.apply(this, args)
}
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
;(globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number
;(globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) =>
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>)

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function render(node: ReactElement) {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  flushSync(() => { root.render(node) })
  return { container, root }
}

function buttonNamed(container: Element, label: string): HTMLButtonElement | null {
  return [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === label) as HTMLButtonElement | null
}

const before: TrackPoint[] = Array.from({ length: 30 }, (_, index) => ({
  lat: 40 + index * 0.001,
  lon: -75 + index * 0.0012,
  ele: 300 + index * 2,
  time: 1_700_000_000_000 + index * 1000,
}))
const after = before.filter((_, index) => index !== 11 && index !== 12)

function request(overrides: Partial<RepairPreviewRequest> = {}): RepairPreviewRequest {
  return {
    title: 'Drop outliers',
    summary: 'Removed 2 points that broke their local trend',
    warnings: [],
    before,
    after,
    diff: computeTrackDiff(before, after),
    ...overrides,
  }
}

console.log('renders the comparison')
{
  const { container } = render(<RepairPreviewDialog request={request()} onAccept={() => {}} onRevert={() => {}} />)
  check('the dialog is modal', container.querySelector('.dialog-repair-preview')?.getAttribute('aria-modal') === 'true')
  check('the title names the operation', container.querySelector('.dialog-title')?.textContent?.includes('Drop outliers') === true)
  check('the summary is shown', container.querySelector('.dialog-message')?.textContent?.includes('Removed 2 points') === true)
  check('both paths are drawn', container.querySelectorAll('.diff-line-before').length === 1 && container.querySelectorAll('.diff-line-after').length === 1)
  check('removed samples are marked', container.querySelectorAll('.diff-marker-removed').length > 0)
  const facts = [...container.querySelectorAll('.dialog-details li')].map((item) => item.textContent ?? '')
  check('the point counts are stated', facts.some((fact) => fact.includes('30') && fact.includes('28')), facts.join(' | '))
  check('the removed count is stated', facts.some((fact) => fact.includes('2 removed')), facts.join(' | '))
  check('the gate says nothing has been applied', container.textContent?.includes('Nothing has been applied yet') === true)
}

console.log('accept and revert')
{
  let accepted = 0
  let reverted = 0
  focused.length = 0
  const { container } = render(<RepairPreviewDialog request={request()} onAccept={() => { accepted++ }} onRevert={() => { reverted++ }} />)

  check('Revert holds initial focus, so a stray Enter takes the safe path', focused[focused.length - 1] === buttonNamed(container, 'Revert'))

  flushSync(() => { buttonNamed(container, 'Accept')?.click() })
  check('Accept applies exactly once', accepted === 1 && reverted === 0, `accepted=${accepted} reverted=${reverted}`)

  flushSync(() => { buttonNamed(container, 'Revert')?.click() })
  check('Revert discards without applying', reverted === 1 && accepted === 1, `accepted=${accepted} reverted=${reverted}`)
}

console.log('dismissal defaults to revert')
{
  let accepted = 0
  let reverted = 0
  const { container } = render(<RepairPreviewDialog request={request()} onAccept={() => { accepted++ }} onRevert={() => { reverted++ }} />)

  // linkedom has no KeyboardEvent constructor; the handler only reads `key`.
  const escape = new window.Event('keydown', { bubbles: true, cancelable: true }) as Event & { key: string }
  escape.key = 'Escape'
  flushSync(() => { window.document.dispatchEvent(escape as unknown as Event) })
  check('Escape reverts', reverted === 1 && accepted === 0, `accepted=${accepted} reverted=${reverted}`)

  const backdrop = container.querySelector('.dialog-backdrop')!
  const mouseDown = new window.Event('mousedown', { bubbles: true })
  flushSync(() => { backdrop.dispatchEvent(mouseDown as unknown as Event) })
  check('clicking outside the dialog reverts', reverted === 2 && accepted === 0, `accepted=${accepted} reverted=${reverted}`)
}

console.log('offers only the views the diff supports')
{
  // A pure retiming moves nothing in plan, so only the profile is offered.
  const retimed = before.map((point) => ({ ...point, time: point.time! + 5000 }))
  const { container } = render(
    <RepairPreviewDialog
      request={request({ title: 'Shift time', after: retimed, diff: computeTrackDiff(before, retimed) })}
      onAccept={() => {}}
      onRevert={() => {}}
    />,
  )
  const tabs = [...container.querySelectorAll('[role=tab]')].map((tab) => tab.textContent)
  check('no view switcher is shown when there is one view', tabs.length === 0, tabs.join(','))
  check('the profile is what gets drawn', container.querySelector('.diff-axis') !== null)
}

console.log('a rebuilt track still gets an honest preview')
{
  // Deliberately off-grid from `before`: nothing the operation emitted shares a
  // geometry key with the original, which is what a real resample produces.
  const rebuilt = Array.from({ length: 12 }, (_, index) => ({
    lat: 40.00031 + index * 0.0025, lon: -75.00042 + index * 0.003, ele: 301.5 + index * 5, time: 1_700_000_000_137 + index * 2500,
  }))
  const diff = computeTrackDiff(before, rebuilt)
  const { container } = render(<RepairPreviewDialog request={request({ title: 'Resample', after: rebuilt, diff })} onAccept={() => {}} onRevert={() => {}} />)
  check('both paths are still drawn', container.querySelectorAll('.diff-line').length === 2)
  check('the caption admits the samples were resynthesized', container.textContent?.includes('resynthesized') === true)
  check('both views are offered', container.querySelectorAll('[role=tab]').length === 2)
}

console.log('warnings surface at the gate')
{
  const { container } = render(
    <RepairPreviewDialog request={request({ warnings: ['3 gaps skipped: fill would imply supersonic motion'] })} onAccept={() => {}} onRevert={() => {}} />,
  )
  check('the operation warning is visible', container.querySelector('.repair-preview-warnings')?.textContent?.includes('supersonic') === true)
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll repair-preview checks passed.')
