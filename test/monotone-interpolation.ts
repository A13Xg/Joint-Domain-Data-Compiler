// Task 5.2: monotone cubic interpolation (Fritsch-Carlson), the resampling
// primitive behind distance-based resampling. Covers edge/invalid inputs,
// immutability, and — the whole point of the method — no overshoot/
// undershoot versus what a naive (natural) cubic spline produces on the
// same synthetic monotone step dataset.
import { evaluateMonotoneCubic, fitMonotoneCubic, monotoneCubicInterpolate } from '../src/core/operations/monotone-interpolation.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// --- A minimal natural cubic spline, used only as a reference implementation
// in this test to demonstrate the overshoot monotone cubic avoids. Not part
// of production code (Butterworth-adjacent naive-spline approaches are
// explicitly out of scope per the build plan).
function naturalCubicSpline(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length
  const h = xs.slice(0, -1).map((x, i) => xs[i + 1]! - x)
  const alpha = new Array(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    alpha[i] = (3 / h[i]!) * (ys[i + 1]! - ys[i]!) - (3 / h[i - 1]!) * (ys[i]! - ys[i - 1]!)
  }
  const l = new Array(n).fill(1)
  const mu = new Array(n).fill(0)
  const z = new Array(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    l[i] = 2 * (xs[i + 1]! - xs[i - 1]!) - h[i - 1]! * mu[i - 1]!
    mu[i] = h[i]! / l[i]!
    z[i] = (alpha[i]! - h[i - 1]! * z[i - 1]!) / l[i]!
  }
  const c = new Array(n).fill(0)
  const b = new Array(n).fill(0)
  const d = new Array(n).fill(0)
  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j]! - mu[j]! * c[j + 1]!
    b[j] = (ys[j + 1]! - ys[j]!) / h[j]! - (h[j]! * (c[j + 1]! + 2 * c[j]!)) / 3
    d[j] = (c[j + 1]! - c[j]!) / (3 * h[j]!)
  }
  return (x: number) => {
    let i = 0
    while (i < n - 2 && x > xs[i + 1]!) i++
    const dx = x - xs[i]!
    return ys[i]! + b[i]! * dx + c[i]! * dx * dx + d[i]! * dx * dx * dx
  }
}

// --- Edge / invalid inputs ---------------------------------------------------
{
  let threw = false
  try { fitMonotoneCubic([], []) } catch { threw = true }
  check('Empty knot arrays are rejected', threw)
}
{
  let threw = false
  try { fitMonotoneCubic([1], [1]) } catch { threw = true }
  check('A single knot is rejected (need at least two)', threw)
}
{
  let threw = false
  try { fitMonotoneCubic([1, 2, 3], [1, 2]) } catch { threw = true }
  check('Mismatched xs/ys lengths are rejected', threw)
}
{
  let threw = false
  try { fitMonotoneCubic([1, 1, 2], [1, 2, 3]) } catch { threw = true }
  check('Non-strictly-increasing xs (duplicate) are rejected', threw)
}
{
  let threw = false
  try { fitMonotoneCubic([2, 1, 3], [1, 2, 3]) } catch { threw = true }
  check('Out-of-order xs are rejected', threw)
}
{
  const spline = fitMonotoneCubic([0, 10], [5, 15])
  check('Two-knot spline is linear at midpoint', evaluateMonotoneCubic(spline, 5) === 10)
  check('Two-knot spline clamps below range', evaluateMonotoneCubic(spline, -5) === 5)
  check('Two-knot spline clamps above range', evaluateMonotoneCubic(spline, 15) === 15)
}

// --- Immutability -------------------------------------------------------------
{
  const xs = [0, 1, 2, 3]
  const ys = [0, 1, 4, 9]
  const xsCopy = [...xs]
  const ysCopy = [...ys]
  fitMonotoneCubic(xs, ys)
  check('fitMonotoneCubic does not mutate input xs', JSON.stringify(xs) === JSON.stringify(xsCopy))
  check('fitMonotoneCubic does not mutate input ys', JSON.stringify(ys) === JSON.stringify(ysCopy))
}

// --- Exact interpolation at knots ---------------------------------------------
{
  const xs = [0, 1, 2, 3, 4]
  const ys = [0, 2, 3, 3, 8]
  const spline = fitMonotoneCubic(xs, ys)
  for (let i = 0; i < xs.length; i++) {
    check(`Interpolant matches knot y at x=${xs[i]}`, Math.abs(evaluateMonotoneCubic(spline, xs[i]!) - ys[i]!) < 1e-9)
  }
}

// --- No overshoot on a synthetic monotone step dataset, vs. a naive cubic spline
{
  // A flat-flat-step-flat-flat step function is a classic case where a
  // natural cubic spline rings past the data range near the step; monotone
  // cubic interpolation is defined precisely to prevent that.
  const xs = [0, 1, 2, 3, 4, 5]
  const ys = [0, 0, 0, 10, 10, 10]
  const monotone = fitMonotoneCubic(xs, ys)
  const naive = naturalCubicSpline(xs, ys)

  const min = Math.min(...ys)
  const max = Math.max(...ys)
  let monotoneOvershoot = false
  let naiveOvershoot = false
  const samples: number[] = []
  for (let x = 0; x <= 5; x += 0.05) samples.push(Number(x.toFixed(2)))

  for (const x of samples) {
    const mv = evaluateMonotoneCubic(monotone, x)
    const nv = naive(x)
    if (mv < min - 1e-9 || mv > max + 1e-9) monotoneOvershoot = true
    if (nv < min - 1e-9 || nv > max + 1e-9) naiveOvershoot = true
  }

  check('Monotone cubic never overshoots/undershoots the [min, max] of the dataset', !monotoneOvershoot)
  check('The naive natural cubic spline reference DOES overshoot on this dataset (sanity check on the test itself)', naiveOvershoot)

  // Stronger, local check: within every single segment, monotone cubic stays
  // within [min(y_i, y_i+1), max(y_i, y_i+1)] — the formal Fritsch-Carlson guarantee.
  let localOvershoot = false
  for (let i = 0; i < xs.length - 1; i++) {
    const lo = Math.min(ys[i]!, ys[i + 1]!)
    const hi = Math.max(ys[i]!, ys[i + 1]!)
    for (let t = 0; t <= 1; t += 0.05) {
      const x = xs[i]! + t * (xs[i + 1]! - xs[i]!)
      const v = evaluateMonotoneCubic(monotone, x)
      if (v < lo - 1e-9 || v > hi + 1e-9) localOvershoot = true
    }
  }
  check('Monotone cubic stays within each local segment range (per-interval Fritsch-Carlson bound)', !localOvershoot)
}

// --- Batch helper matches manual fit+evaluate ---------------------------------
{
  const xs = [0, 2, 5, 9]
  const ys = [1, 3, 2, 8]
  const spline = fitMonotoneCubic(xs, ys)
  const queries = [0, 1, 3.5, 7, 9]
  const batch = monotoneCubicInterpolate(xs, ys, queries)
  const manual = queries.map((x) => evaluateMonotoneCubic(spline, x))
  check('monotoneCubicInterpolate matches fit+evaluate', JSON.stringify(batch) === JSON.stringify(manual))
}

console.log(`\n${failures === 0 ? 'ALL MONOTONE INTERPOLATION CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
