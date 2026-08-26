// Placeholder shape shown while a panel's data is being computed.
//
// Preferred over a bare spinner where the eventual layout is known: the page
// does not reflow when the content lands, and the shape itself tells the user
// what is coming. Individually aria-hidden — the surrounding panel carries the
// live-region label, so a screen reader hears "scanning" once rather than one
// announcement per grey box.

interface SkeletonProps {
  /** CSS width, e.g. '60%' or 120. */
  width?: string | number
  height?: string | number
  radius?: string | number
}

export function Skeleton({ width = '100%', height = 14, radius = 6 }: SkeletonProps) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius }} aria-hidden="true" />
}
