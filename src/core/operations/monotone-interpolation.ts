/**
 * Fritsch–Carlson monotone cubic interpolation (Hermite form with a
 * monotonicity-preserving slope limiter). Unlike a naive/natural cubic
 * spline, this never overshoots or undershoots the value range spanned by
 * its two neighboring knots — the reason it is the safe choice for
 * distance-based resampling of physical quantities (elevation, latitude,
 * longitude) where spline "ringing" past the true local extremes would be a
 * worse error than the piecewise-linear interpolation it is meant to
 * improve on.
 *
 * Reference: F. N. Fritsch & R. E. Carlson, "Monotone Piecewise Cubic
 * Interpolation", SIAM J. Numer. Anal. 17(2), 1980, pp. 238-246.
 */

export interface MonotoneCubicSpline {
  xs: number[]
  ys: number[]
  slopes: number[]
}

/** Fit a monotonicity-preserving cubic Hermite spline through (xs[i], ys[i]). `xs` must be strictly increasing. */
export function fitMonotoneCubic(xs: number[], ys: number[]): MonotoneCubicSpline {
  if (xs.length !== ys.length) throw new Error('xs and ys must have the same length')
  const n = xs.length
  if (n < 2) throw new Error('Monotone cubic interpolation requires at least two knots')
  for (let i = 1; i < n; i++) {
    if (!(xs[i]! > xs[i - 1]!)) throw new Error('xs must be strictly increasing')
  }

  if (n === 2) {
    const d = (ys[1]! - ys[0]!) / (xs[1]! - xs[0]!)
    return { xs: [...xs], ys: [...ys], slopes: [d, d] }
  }

  const secants: number[] = []
  for (let i = 0; i < n - 1; i++) secants.push((ys[i + 1]! - ys[i]!) / (xs[i + 1]! - xs[i]!))

  // Initial tangent estimate: average of adjacent secants, but zero at any
  // local extremum (sign change or flat secant) so the limiter below has a
  // monotone starting point to work from.
  const slopes: number[] = new Array(n)
  slopes[0] = secants[0]!
  slopes[n - 1] = secants[n - 2]!
  for (let i = 1; i < n - 1; i++) {
    const left = secants[i - 1]!
    const right = secants[i]!
    slopes[i] = left === 0 || right === 0 || (left < 0) !== (right < 0) ? 0 : (left + right) / 2
  }

  // Fritsch-Carlson limiter: rescale (m_k, m_{k+1}) so the Hermite segment
  // between knot k and k+1 stays within [min(y_k, y_{k+1}), max(y_k, y_{k+1})].
  for (let k = 0; k < n - 1; k++) {
    const dk = secants[k]!
    if (dk === 0) {
      slopes[k] = 0
      slopes[k + 1] = 0
      continue
    }
    const a = Math.max(0, slopes[k]! / dk)
    const b = Math.max(0, slopes[k + 1]! / dk)
    if (slopes[k]! / dk < 0) slopes[k] = 0
    if (slopes[k + 1]! / dk < 0) slopes[k + 1] = 0
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      slopes[k] = t * a * dk
      slopes[k + 1] = t * b * dk
    }
  }

  return { xs: [...xs], ys: [...ys], slopes }
}

/** Evaluate a fitted monotone cubic spline at `x`, clamping to the endpoint values outside the knot range. */
export function evaluateMonotoneCubic(spline: MonotoneCubicSpline, x: number): number {
  const { xs, ys, slopes } = spline
  const n = xs.length
  if (x <= xs[0]!) return ys[0]!
  if (x >= xs[n - 1]!) return ys[n - 1]!

  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid]! <= x) lo = mid
    else hi = mid
  }

  const h = xs[hi]! - xs[lo]!
  const t = (x - xs[lo]!) / h
  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = t3 - 2 * t2 + t
  const h01 = -2 * t3 + 3 * t2
  const h11 = t3 - t2
  return h00 * ys[lo]! + h10 * h * slopes[lo]! + h01 * ys[hi]! + h11 * h * slopes[hi]!
}

/** Fit a monotone cubic through (xs, ys) and sample it at each of `queryXs`. */
export function monotoneCubicInterpolate(xs: number[], ys: number[], queryXs: number[]): number[] {
  const spline = fitMonotoneCubic(xs, ys)
  return queryXs.map((x) => evaluateMonotoneCubic(spline, x))
}
