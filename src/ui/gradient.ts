// Viridis-style perceptual gradient, shared by the map's channel colouring and
// the density overlay.
//
// A plain module rather than an export from MapView.tsx: component files may
// only export components (react-refresh/only-export-components), which is why
// this lived as a private duplicate-in-waiting there. Same precedent as
// core/reports/exportNaming.ts.

const STOPS = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]

/** Maps 0..1 onto the gradient. Values outside the range clamp to the ends. */
export function gradientColor(value: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const segment = clamped * (STOPS.length - 1)
  const index = Math.floor(segment)
  const fraction = segment - index
  const start = STOPS[index]!
  const end = STOPS[Math.min(STOPS.length - 1, index + 1)]!
  const color = start.map((component, componentIndex) => Math.round(component + (end[componentIndex]! - component) * fraction))
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`
}
