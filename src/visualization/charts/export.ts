// Chart image export: turns the live, on-screen `<svg>` into a standalone
// file. The chart's styling is split between external CSS classes
// (`.chart-line`, `.chart-grid`, `.chart-axis-label`, `.chart-event-*`, …)
// and a handful of inline `style={{}}` overrides (per-series color, the
// selected-point marker), which is fine for the page but means a naive
// `XMLSerializer().serializeToString(svg)` produces an SVG file with no
// stylesheet to resolve those classes against — every line and label would
// render black/default when opened outside this app. Reading each live
// element's *computed* style (cascade + inline already resolved by the
// browser, `var(--…)` custom properties already substituted) and writing it
// back as an explicit inline style on the clone makes the export
// self-contained regardless of what produced the original look.
//
// "Annotations preserved" (the roadmap item's phrasing) is read plainly:
// whatever is currently painted in the chart — series lines, rendered
// points, quality-event markers, axis labels, the selected-point/range
// indicators — travels into the export. The only elements dropped are ones
// that are meaningless once static: the hover crosshair (follows a cursor
// that no longer exists in a saved file) and any live drag-preview rect.

const EXPORTED_STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-family', 'text-anchor'] as const
const EPHEMERAL_SELECTORS = '.chart-crosshair'

/** Reads the app's resolved dark-palette background so a standalone export
 *  matches what's on screen instead of defaulting to a transparent one. */
function resolveBackgroundColor(): string {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue('--bg-1').trim()
  return value || '#111725'
}

/**
 * Produces a self-contained SVG XML string for the given live chart SVG:
 * every element's computed presentation style is inlined, ephemeral
 * (hover/drag) elements are dropped, a background rect is added so the
 * result looks the same opened standalone as it does on screen, and the
 * root gets an explicit `xmlns`/`width`/`height` so it's a valid document
 * on its own rather than a fragment meant to live inside an HTML page.
 */
export function serializeChartSvg(svg: SVGSVGElement, width: number, height: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const liveElements = svg.querySelectorAll('*')
  const clonedElements = clone.querySelectorAll('*')

  const inlineComputedStyle = (source: Element, target: Element) => {
    const computed = window.getComputedStyle(source)
    const declarations = EXPORTED_STYLE_PROPS.map((prop) => `${prop}:${computed.getPropertyValue(prop)}`).join(';')
    const existing = target.getAttribute('style')
    target.setAttribute('style', existing ? `${existing};${declarations}` : declarations)
  }
  inlineComputedStyle(svg, clone)
  liveElements.forEach((element, index) => {
    const target = clonedElements[index]
    if (target) inlineComputedStyle(element, target)
  })

  clone.querySelectorAll(EPHEMERAL_SELECTORS).forEach((element) => element.remove())

  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  background.setAttribute('x', '0')
  background.setAttribute('y', '0')
  background.setAttribute('width', String(width))
  background.setAttribute('height', String(height))
  background.setAttribute('fill', resolveBackgroundColor())
  clone.insertBefore(background, clone.firstChild)

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${new XMLSerializer().serializeToString(clone)}`
}

/** Rasterizes an already-serialized standalone SVG string to a PNG blob at
 *  `scale`x the SVG's own pixel dimensions ("high-quality" per the roadmap
 *  item — 2x reads crisply at typical report/slide sizes without producing
 *  an unreasonably large file for a chart this size). */
export async function svgStringToPngBlob(svgString: string, width: number, height: number, scale = 2): Promise<Blob> {
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  try {
    const image = new Image()
    image.src = url
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Could not rasterize the chart SVG'))
    })

    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    context.scale(scale, scale)
    context.drawImage(image, 0, 0, width, height)

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png')
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function chartExportFilename(extension: 'svg' | 'png'): string {
  return `jddc-chart-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`
}
