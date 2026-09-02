// Task 4.2: pure X-domain zoom math for the time-series chart.
import { isFullyZoomedOut, panDomain, zoomDomain } from '../src/visualization/charts/zoom.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const bounds = { lo: 0, hi: 1000 }

// --- Zooming in keeps the cursor value fixed --------------------------------
{
  const zoomed = zoomDomain(bounds, bounds, 0.5, 0.5) // zoom in 2x centered at value 500
  check('Zooming in shrinks the span', zoomed.hi - zoomed.lo < 1000)
  check('Cursor value (500) stays at the same fraction after zooming in', Math.abs((zoomed.lo + zoomed.hi) / 2 - 500) < 1e-6, `${zoomed.lo}-${zoomed.hi}`)
}

// --- Zooming in off-center keeps that specific value under the cursor -------
{
  const zoomed = zoomDomain(bounds, bounds, 0.1, 0.5) // cursor near the left edge, value 100
  const cursorValueAfter = zoomed.lo + 0.1 * (zoomed.hi - zoomed.lo)
  check('Off-center zoom keeps the cursor value fixed', Math.abs(cursorValueAfter - 100) < 1e-6, `${cursorValueAfter}`)
}

// --- Zooming out never exceeds bounds ----------------------------------------
{
  const narrow = { lo: 400, hi: 600 }
  const zoomedOut = zoomDomain(narrow, bounds, 0.5, 100) // absurdly large zoom-out factor
  check('Zooming out clamps to the data bounds', zoomedOut.lo === bounds.lo && zoomedOut.hi === bounds.hi)
  check('isFullyZoomedOut recognizes the clamped result', isFullyZoomedOut(zoomedOut, bounds))
}

// --- Zooming in never collapses to zero/negative span -----------------------
{
  let domain = bounds
  for (let i = 0; i < 200; i++) domain = zoomDomain(domain, bounds, 0.5, 0.5)
  check('Repeated zoom-in converges to a positive minimum span, never collapsing', domain.hi > domain.lo)
}

// --- Panning stays within bounds when zoomed near an edge -------------------
{
  const nearLeftEdge = { lo: 0, hi: 50 }
  const zoomed = zoomDomain(nearLeftEdge, bounds, 0, 0.5) // zoom in anchored at the left edge
  check('Zooming anchored at the domain edge does not go negative', zoomed.lo >= bounds.lo, `${zoomed.lo}`)
}

// --- Degenerate inputs are handled without throwing -------------------------
{
  const degenerateBounds = { lo: 5, hi: 5 }
  const result = zoomDomain(bounds, degenerateBounds, 0.5, 0.5)
  check('A zero-span bounds is a safe no-op', result.lo === bounds.lo && result.hi === bounds.hi)
}
{
  const result = zoomDomain(bounds, bounds, 0.5, -1)
  check('A non-positive zoom factor is a safe no-op', result.lo === bounds.lo && result.hi === bounds.hi)
}

check('isFullyZoomedOut is false for a narrowed domain', !isFullyZoomedOut({ lo: 100, hi: 900 }, bounds))

// --- panDomain: shifts position, never span ----------------------------------
{
  const zoomed = { lo: 400, hi: 500 }
  const panned = panDomain(zoomed, bounds, 0.5)
  check('Panning right shifts the domain forward', panned.lo > zoomed.lo && panned.hi > zoomed.hi)
  check('Panning never changes the span', Math.abs((panned.hi - panned.lo) - (zoomed.hi - zoomed.lo)) < 1e-9)
}
{
  const zoomed = { lo: 400, hi: 500 }
  const panned = panDomain(zoomed, bounds, -0.5)
  check('Panning left shifts the domain backward', panned.lo < zoomed.lo && panned.hi < zoomed.hi)
}
{
  const nearLeftEdge = { lo: 0, hi: 50 }
  const panned = panDomain(nearLeftEdge, bounds, -1)
  check('Panning past the left edge clamps to bounds.lo', panned.lo === bounds.lo)
  check('Clamped pan preserves span', Math.abs((panned.hi - panned.lo) - 50) < 1e-9)
}
{
  const nearRightEdge = { lo: 950, hi: 1000 }
  const panned = panDomain(nearRightEdge, bounds, 1)
  check('Panning past the right edge clamps to bounds.hi', panned.hi === bounds.hi)
}
{
  const fullyZoomedOut = { ...bounds }
  const panned = panDomain(fullyZoomedOut, bounds, 0.5)
  check('Panning at full zoom-out is a no-op (nowhere to go)', panned.lo === bounds.lo && panned.hi === bounds.hi)
}
{
  const degenerate = { lo: 5, hi: 5 }
  const panned = panDomain(degenerate, bounds, 0.5)
  check('A zero-span current domain is a safe no-op', panned.lo === degenerate.lo && panned.hi === degenerate.hi)
}

console.log(`\n${failures === 0 ? 'ALL CHART ZOOM CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
