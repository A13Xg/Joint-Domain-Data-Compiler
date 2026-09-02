// Pure X-domain zoom math for the time-series chart. Kept separate from the
// component so the arithmetic (cursor-anchored zoom, bounds clamping, a
// minimum span floor) can be unit tested without rendering React/SVG.
export interface Domain {
  lo: number
  hi: number
}

const MIN_SPAN_FRACTION = 0.001

/**
 * Zoom `current` by `factor` (< 1 zooms in, > 1 zooms out), keeping the value
 * at `cursorFraction` (0..1 across the current domain) fixed under the
 * cursor. Never zooms out past `bounds` or in past a minimum span.
 */
export function zoomDomain(current: Domain, bounds: Domain, cursorFraction: number, factor: number): Domain {
  const boundsSpan = bounds.hi - bounds.lo
  if (!(boundsSpan > 0) || !(factor > 0)) return current

  const clampedFraction = Math.max(0, Math.min(1, cursorFraction))
  const span = current.hi - current.lo
  const cursorValue = current.lo + clampedFraction * span
  const minSpan = boundsSpan * MIN_SPAN_FRACTION
  const newSpan = Math.min(boundsSpan, Math.max(minSpan, span * factor))

  let newLo = cursorValue - clampedFraction * newSpan
  let newHi = newLo + newSpan
  if (newLo < bounds.lo) { newLo = bounds.lo; newHi = newLo + newSpan }
  if (newHi > bounds.hi) { newHi = bounds.hi; newLo = newHi - newSpan }
  return { lo: newLo, hi: newHi }
}

export function isFullyZoomedOut(domain: Domain, bounds: Domain, epsilon = 1e-9): boolean {
  return Math.abs(domain.lo - bounds.lo) < epsilon && Math.abs(domain.hi - bounds.hi) < epsilon
}

/**
 * Shifts `current` by `deltaFraction` of its own span (negative pans toward
 * `bounds.lo`), clamped so the domain never slides past `bounds` — panning
 * stops at the edge of the data rather than scrolling into empty space.
 * Span is never changed, only position, which is what keeps this a pan
 * rather than a zoom.
 */
export function panDomain(current: Domain, bounds: Domain, deltaFraction: number): Domain {
  const span = current.hi - current.lo
  if (!(span > 0) || !(bounds.hi - bounds.lo > 0)) return current

  const shift = deltaFraction * span
  let newLo = current.lo + shift
  let newHi = current.hi + shift
  if (newLo < bounds.lo) { newLo = bounds.lo; newHi = newLo + span }
  if (newHi > bounds.hi) { newHi = bounds.hi; newLo = newHi - span }
  return { lo: newLo, hi: newHi }
}
