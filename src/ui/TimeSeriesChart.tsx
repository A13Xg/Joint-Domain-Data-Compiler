import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Dataset, TrackPoint } from '../core/model'
import { epochMsToIso } from '../core/format'
import { calculateRangeStatistics } from '../core/analytics/rangeStatistics'
import { detectQualityEvents, type QualityEvent } from '../core/quality/events'
import {
  BUILT_IN_CHART_PRESETS,
  channelIdFromXAxis,
  computeXDomain,
  extractChartSeries,
  numericChannelValue,
  resolvePresetChannels,
  type ChartXAxis,
} from '../visualization/charts/series'
import { zoomDomain, panDomain, isFullyZoomedOut, type Domain } from '../visualization/charts/zoom'
import { chartExportFilename, serializeChartSvg, svgStringToPngBlob } from '../visualization/charts/export'
import { usePointSelection } from '../state/pointSelection'
import { ChartTypeSelector } from './ChartTypeSelector'
import { ChartLegend } from './ChartLegend'
import { SelectionChip } from './SelectionChip'
import { useConfirm } from './confirmContext'
import { useAppSettings } from '../state/settings'
import { convertDistance, distanceUnitLabel } from '../core/units'
import { archiveFile } from '../desktop/fileArchive'
import { logger } from '../core/logger'
import { errorMessage } from '../core/errors'
import { getBestChartType, getValidChartTypes, isMismatch } from '../visualization/charts/validator'

/** Non-color patterns per severity so event markers remain distinguishable for colorblind/low-vision users. */
const EVENT_SEVERITY_DASH: Record<QualityEvent['severity'], string> = {
  error: 'none',
  warning: '4 2',
  info: '1 3',
}

interface SeriesValue {
  x: number
  y: number
  sourceIndex: number
}

interface Series {
  key: string
  color: string
  values: SeriesValue[]
  min: number
  max: number
  downsampled: boolean
}

const PALETTE = ['#ea4f2f', '#0f8c6f', '#3b82f6', '#eab308', '#a855f7', '#ec4899', '#14b8a6']
/** Y-zoom is a fraction of each series' own span, not an absolute value domain — see `yZoomDomain`. */
const FULL_Y_DOMAIN: Domain = { lo: 0, hi: 1 }
/** Below this pixel span, a mouse-up is a click rather than a drag. */
const CLICK_PIXEL_THRESHOLD = 5
/** How close (in screen pixels) a click/drag endpoint must land to a
 *  rendered sample before a delete-set gesture (ctrl/cmd or shift) will
 *  grab it. `nearestValue` searches by x-distance with no upper bound, so
 *  without this a click in empty chart space would silently resolve to
 *  *some* point and add it to the set. Point-selection (a plain click) is
 *  intentionally left unbounded, matching its prior behavior. */
const SET_HIT_PIXEL_RADIUS = 10

/**
 * Mirrors the private label map inside ChartTypeSelector.tsx. Not imported
 * directly: component files in this repo may only export components (per
 * react-refresh/only-export-components), so ChartTypeSelector keeps its
 * label map module-private and this file duplicates the three entries it
 * needs for toast/banner copy — same pattern as ChartLegend's test file
 * duplicating LEGEND_PALETTE for its assertions.
 */
const CHART_TYPE_LABELS: Record<string, string> = {
  timeSeries: 'Time Series',
  scatter: 'Scatter',
  area: 'Area',
}

export function TimeSeriesChart({ points, channels, jumpRequested = false, onJumpHandled, onDeletePoints }: { points: TrackPoint[]; channels: string[]; jumpRequested?: boolean; onJumpHandled?: () => void; onDeletePoints?: (indices: number[]) => void }) {
  const available = useMemo(() => ['elevation', ...channels], [channels])
  const [selected, setSelected] = useState<string[]>(() => available.includes('elevation') ? ['elevation'] : available.slice(0, 1))
  const [xAxis, setXAxis] = useState<ChartXAxis>('time')
  const [presetId, setPresetId] = useState('altitude-time')
  const [hover, setHover] = useState<number | null>(null)
  const [dragStart, setDragStart] = useState<number | null>(null)
  // Tracks ctrl/cmd and shift while a drag is in progress, purely so the drag
  // preview rectangle can show the gesture it will resolve to on release
  // (zoom vs. marquee-add-to-delete-set) before the user lets go.
  const [dragModifiers, setDragModifiers] = useState<{ ctrl: boolean; shift: boolean }>({ ctrl: false, shift: false })
  const [zoomedDomain, setZoomedDomain] = useState<Domain | null>(null)
  // Fraction of each series' own [min, max] span currently in view — shared
  // across series rather than a single absolute value domain, because series
  // are independently auto-scaled and can be in entirely different units
  // (e.g. elevation in metres alongside a turn rate in degrees/second). Null
  // means fully zoomed out, i.e. the full {0,1} span, same convention as
  // `zoomedDomain`.
  const [yZoomDomain, setYZoomDomain] = useState<Domain | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // Y-zoom (unlike X-zoom) doesn't filter the underlying series data, so a
  // zoomed-in line/point can compute outside the plot rect; this clips that
  // geometry back to it rather than letting it bleed into the axis margins.
  const plotClipId = useId()
  const confirm = useConfirm()
  const { chartPointBudget, unitSystem } = useAppSettings()
  const { pointIndex, hoverIndex, indexRange, indexSet, selectPoint, setHoverIndex, toggleInSet, extendSetRange, unionSetRange, clearPointSelection, clearRangeSelection, clearSet, clearHover } = usePointSelection(points)
  const indexSetLookup = useMemo(() => new Set(indexSet), [indexSet])

  // Synthetic Dataset view over (points, channels): the chart-type validator
  // and the ChartTypeSelector/ChartLegend components operate on Dataset, but
  // this component has only ever taken points/channels props. Only `points`
  // and `channels` are read by those consumers today; the remaining fields
  // are unused placeholders.
  const dataset = useMemo<Dataset>(() => ({
    id: 'time-series-chart-view',
    name: 'Time Series Chart',
    sourceFormat: 'unknown',
    points,
    warnings: [],
    channels,
    createdAt: 0,
  }), [points, channels])

  // Lazy-initialized so the very first render already lands on a valid type
  // for whatever dataset is passed in (no first-paint flash of a mismatched
  // default + a "we just auto-corrected it" toast on mount).
  const [chartType, setChartType] = useState<string>(() => (
    isMismatch(dataset, 'timeSeries') ? getBestChartType(dataset) : 'timeSeries'
  ))
  const [visibleChannels, setVisibleChannels] = useState<string[]>(() => channels.filter((channel) => channel !== 'timestamp'))
  const [toast, setToast] = useState<string | null>(null)

  // Auto-recover when the dataset changes *after* mount underneath the
  // current chart-type selection (e.g. switching to a dataset with no
  // timestamps while a time-series chart is selected). This adjusts state
  // directly during render (React's documented pattern for "adjust state
  // when a prop/derived value changes") rather than in a useEffect, so the
  // correction lands in the same commit instead of a visible extra render —
  // see https://react.dev/learn/you-might-not-need-an-effect.
  const [lastMismatchCheckedDataset, setLastMismatchCheckedDataset] = useState(dataset)
  if (dataset !== lastMismatchCheckedDataset) {
    setLastMismatchCheckedDataset(dataset)
    if (isMismatch(dataset, chartType)) {
      const best = getBestChartType(dataset)
      setChartType(best)
      setToast(`"${CHART_TYPE_LABELS[chartType] ?? chartType}" doesn't fit this dataset — switched to "${CHART_TYPE_LABELS[best] ?? best}".`)
    }
  }

  // Auto-dismiss the toast. Deferring the setState through setTimeout (rather
  // than calling it synchronously in the effect body) is the supported
  // pattern for effect-driven timers.
  useEffect(() => {
    if (toast === null) return
    const id = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(id)
  }, [toast])

  const chartTypeMismatch = isMismatch(dataset, chartType)
  const recommendedChartType = useMemo(() => getBestChartType(dataset), [dataset])
  const chartTypeReason = useMemo(
    () => getValidChartTypes(dataset).find((info) => info.type === chartType)?.reason,
    [dataset, chartType],
  )

  // Kept decoupled from the `selected`/`toggle` series-visibility mechanism
  // below (which drives what's actually plotted, and is untouched by this
  // integration) so the legend's own visible/hidden bookkeeping never
  // changes the existing chart rendering path's behavior.
  const handleToggleChannel = useCallback((channelKey: string) => {
    setVisibleChannels((current) => current.includes(channelKey)
      ? current.filter((key) => key !== channelKey)
      : [...current, channelKey])
  }, [])

  const hasTime = useMemo(() => points.some((point) => point.time !== undefined), [points])
  const hasDistance = useMemo(() => points.some((point) => typeof point.ext?.distance_m === 'number'), [points])
  // A channel x-axis is only ever offered in the toolbar while chartType === 'scatter' (see the
  // <select> below), but the underlying `xAxis` state is not force-reset when the chart type
  // changes away from scatter — same non-mutating fallback pattern as hasTime/hasDistance above,
  // so switching back to scatter later restores the channel choice. A line/area chart drawn
  // through non-monotonic channel values would be a scribble, not a chart, so this is a hard gate.
  const xAxisChannelId = channelIdFromXAxis(xAxis)
  const channelAxisUsable = xAxisChannelId !== null && chartType === 'scatter' && available.includes(xAxisChannelId)
  const effectiveX: ChartXAxis = xAxisChannelId !== null
    ? (channelAxisUsable ? xAxis : 'index')
    : xAxis === 'time' && !hasTime ? 'index'
      : xAxis === 'distance' && !hasDistance ? 'index'
        : xAxis
  const qualityEvents = useMemo(() => detectQualityEvents(points), [points])

  // Full-extent domain computed once from raw points — never from a (possibly downsampled)
  // series, so it can't shrink as a side effect of the budget that reduces `series` below.
  const xDomain = useMemo(() => computeXDomain(points, effectiveX), [points, effectiveX])

  const effectiveDomain = zoomedDomain ?? xDomain
  const effectiveYDomain = yZoomDomain ?? FULL_Y_DOMAIN
  const isXZoomed = zoomedDomain !== null && xDomain !== null && !isFullyZoomedOut(zoomedDomain, xDomain)
  const isYZoomed = yZoomDomain !== null && !isFullyZoomedOut(yZoomDomain, FULL_Y_DOMAIN)
  const isZoomed = isXZoomed || isYZoomed
  const resetZoom = () => { setZoomedDomain(null); setYZoomDomain(null) }

  // Filtering to `effectiveDomain` before downsampling is what makes zooming recover resolution:
  // each zoom level re-spends the same sample budget over just the visible window instead of
  // remapping whatever the full-extent view already picked.
  const series = useMemo<Series[]>(() => selected.map((key, index) => {
    const data = extractChartSeries(points, key, effectiveX, chartPointBudget, effectiveDomain)
    return {
      key,
      color: PALETTE[index % PALETTE.length]!,
      values: data.samples.map((sample) => ({ x: sample.x, y: sample.y, sourceIndex: sample.sourceIndex })),
      min: data.min,
      max: data.max,
      downsampled: data.downsampled,
    }
  }), [points, selected, effectiveX, effectiveDomain, chartPointBudget])

  const cursorX = useMemo(() => {
    if (hover !== null) return hover
    if (hoverIndex === null) return null
    return pointX(points[hoverIndex], hoverIndex, effectiveX)
  }, [hover, hoverIndex, points, effectiveX])

  const selectedX = useMemo(() => {
    if (pointIndex === null) return null
    return pointX(points[pointIndex], pointIndex, effectiveX)
  }, [pointIndex, points, effectiveX])

  const rangeX = useMemo(() => {
    if (!indexRange) return null
    const start = pointX(points[indexRange.start], indexRange.start, effectiveX)
    const end = pointX(points[indexRange.end], indexRange.end, effectiveX)
    return start !== null && end !== null ? { start, end } : null
  }, [indexRange, points, effectiveX])

  const eventMarkers = useMemo(() => qualityEvents
    .map((event) => ({ event, x: pointX(points[event.endIndex], event.endIndex, effectiveX) }))
    .filter((marker): marker is { event: QualityEvent; x: number } => marker.x !== null),
  [qualityEvents, points, effectiveX])

  const statistics = useMemo(
    () => indexRange ? calculateRangeStatistics(points, indexRange, selected) : null,
    [points, indexRange, selected],
  )

  // Zoom to an incoming drill-down target. Adjusted during render (React's documented pattern
  // for reacting to a changed prop) rather than in an effect, so the zoom lands in the same
  // commit instead of a visible extra render — the same approach as the chart-type recovery above.
  // Shared by the incoming drill-down and the selection badges, so clicking a
  // badge lands on exactly the same view the drill-down does. Which samples to
  // frame is passed in rather than inferred: a point and a range can both be
  // live at once, and picking the range first would zoom the point badge to
  // something other than the point it names.
  const zoomToSelection = (want: 'point' | 'range' | 'selection') => {
    if (!xDomain) return
    const target = want !== 'point' && indexRange
      ? { lo: pointX(points[indexRange.start], indexRange.start, effectiveX), hi: pointX(points[indexRange.end], indexRange.end, effectiveX) }
      : want !== 'range' && pointIndex !== null
        ? (() => {
            const x = pointX(points[pointIndex], pointIndex, effectiveX)
            return x === null ? null : { lo: x, hi: x }
          })()
        : null
    if (!target || target.lo === null || target.hi === null) return
    const totalSpan = xDomain.hi - xDomain.lo
    const targetSpan = Math.max(target.hi - target.lo, totalSpan * 0.02)
    const padding = Math.max(targetSpan * 0.5, totalSpan * 0.05)
    setZoomedDomain({ lo: Math.max(xDomain.lo, target.lo - padding), hi: Math.min(xDomain.hi, target.hi + padding) })
  }

  const [jumpApplied, setJumpApplied] = useState(jumpRequested)
  if (jumpRequested !== jumpApplied) {
    setJumpApplied(jumpRequested)
    if (jumpRequested) zoomToSelection('selection')
  }

  // Report the jump as consumed so re-entering the charts tab later does not replay it.
  useEffect(() => {
    if (jumpRequested) onJumpHandled?.()
  }, [jumpRequested, onJumpHandled])

  const width = 900
  const height = 320
  const pad = { top: 16, right: 16, bottom: 34, left: 56 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom

  const applyPreset = (id: string) => {
    const preset = BUILT_IN_CHART_PRESETS.find((item) => item.id === id)
    if (!preset) return
    const resolved = resolvePresetChannels(preset, channels)
    setPresetId(id)
    setXAxis(preset.xAxis)
    setSelected(resolved.length > 0 ? resolved : ['elevation'])
    resetZoom()
  }

  const toggle = (key: string) => setSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])

  const xToPx = (x: number) => effectiveDomain ? pad.left + ((x - effectiveDomain.lo) / (effectiveDomain.hi - effectiveDomain.lo)) * plotW : pad.left

  // The visible slice of a series' own [min, max], per `effectiveYDomain`'s fraction.
  const yRange = (item: Series) => {
    const span = item.max - item.min
    return { min: item.min + effectiveYDomain.lo * span, max: item.min + effectiveYDomain.hi * span }
  }
  const yToPx = (item: Series, value: number) => {
    const { min, max } = yRange(item)
    const span = max - min || 1
    return pad.top + plotH - ((value - min) / span) * plotH
  }

  // Converts a screen point to this SVG's own user-space (viewBox)
  // coordinates via its screen CTM, rather than the naive
  // `(clientX - rect.left) / rect.width * width` a bounding-rect alone gives.
  // `.chart-svg` is `height: auto` under a `max-height` cap (index.css), so
  // whenever that cap binds the rendered box's aspect ratio stops matching
  // the viewBox's 900:320 and the default `preserveAspectRatio="xMidYMid
  // meet"` letterboxes — content is uniformly scaled to the constraining
  // dimension and centered, not stretched to fill the box. A rect-ratio
  // conversion silently ignores that letterbox margin and mis-locates every
  // click by however wide the margin is; the CTM already knows the real
  // transform because it's what the browser used to paint the shapes.
  const screenToViewBox = (clientX: number, clientY: number): { x: number; y: number; scale: number } | null => {
    const svg = svgRef.current
    if (!svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const point = svg.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const transformed = point.matrixTransform(ctm.inverse())
    return { x: transformed.x, y: transformed.y, scale: ctm.a }
  }

  const eventX = (event: React.MouseEvent<SVGSVGElement>): number | null => {
    if (!effectiveDomain) return null
    const converted = screenToViewBox(event.clientX, event.clientY)
    if (!converted) return null
    const fraction = (converted.x - pad.left) / plotW
    return effectiveDomain.lo + Math.max(0, Math.min(1, fraction)) * (effectiveDomain.hi - effectiveDomain.lo)
  }

  // Trackpad horizontal swipe reports a non-zero deltaX on its own; shift+wheel
  // is the conventional way to pan with a plain vertical scroll wheel. Either
  // one pans instead of zooming — a single wheel gesture never does both.
  //
  // Ctrl/⌘+wheel zooms the Y axis instead of X — cursor-anchored the same
  // way, but against `yZoomDomain`'s {0,1} fraction-of-span rather than an
  // absolute value domain (see `yZoomDomain`'s own comment for why). Ctrl/⌘
  // is otherwise only read on click/drag (the delete-set gesture), never on
  // wheel, so there is nothing to conflict with here. Ctrl/⌘+shift+wheel
  // pans Y the same way shift+wheel pans X.
  const onWheelZoom = (event: WheelEvent) => {
    if (!xDomain) return
    const converted = screenToViewBox(event.clientX, event.clientY)
    if (!converted) return
    event.preventDefault()

    if (event.ctrlKey || event.metaKey) {
      const currentY = yZoomDomain ?? FULL_Y_DOMAIN
      if (event.shiftKey) {
        const deltaFraction = (event.deltaY / converted.scale) / plotH
        setYZoomDomain(panDomain(currentY, FULL_Y_DOMAIN, deltaFraction))
        return
      }
      // Screen Y grows downward, value grows upward — invert to a value fraction.
      const valueFraction = 1 - (converted.y - pad.top) / plotH
      const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2
      setYZoomDomain(zoomDomain(currentY, FULL_Y_DOMAIN, valueFraction, factor))
      return
    }

    const current = zoomedDomain ?? xDomain
    if (event.deltaX !== 0 || event.shiftKey) {
      const deltaPx = event.deltaX !== 0 ? event.deltaX : event.deltaY
      const deltaFraction = (deltaPx / converted.scale) / plotW
      setZoomedDomain(panDomain(current, xDomain, deltaFraction))
      return
    }
    const fraction = (converted.x - pad.left) / plotW
    const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2
    setZoomedDomain(zoomDomain(current, xDomain, fraction, factor))
  }

  // React attaches JSX `onWheel` as a passive DOM listener, which silently
  // drops `preventDefault()` (with a console warning) and lets the page
  // scroll underneath the chart at the same time it zooms/pans. A real
  // listener registered with `{ passive: false }` is the only way to make
  // the two mutually exclusive. Re-registered every render so it always
  // closes over the current domain/state, same as the JSX-prop version did.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    svg.addEventListener('wheel', onWheelZoom, { passive: false })
    return () => svg.removeEventListener('wheel', onWheelZoom)
  })

  if (available.length === 0) return <div className="chart-empty">No numeric channels available to plot.</div>

  const onMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    // Without this, a drag that starts here still lets the browser run its
    // native text selection over whatever <text> axis labels the drag passes
    // under, highlighting them alongside the intended zoom/select gesture.
    // `user-select: none` on `.chart-svg` (index.css) stops selection from
    // *starting* inside the chart, but not one that starts here and is
    // dragged outward — only preventDefault on mousedown does that.
    event.preventDefault()
    setDragStart(eventX(event))
    setDragModifiers({ ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey })
  }

  // Gesture map (mirrors the Table grid's ctrl=toggle / shift=extend
  // vocabulary so the two surfaces teach the same thing):
  //   click                -> select point (unbounded nearest-sample search, unchanged)
  //   drag                 -> zoom to the dragged span
  //   ctrl/cmd+click       -> toggle nearest sample into the delete set
  //   ctrl/cmd+drag        -> add the run between two samples to the delete set
  //   shift+click(/drag)   -> extend the delete set from its anchor
  // The delete-set gestures only arm once the reference series (series[0])
  // is rendering every sample in the window — below that, a "point" on
  // screen is an extrema-preserving stand-in, not a real, single index, and
  // a set built from screen position would not be exact by construction.
  const onMouseUp = (event: React.MouseEvent<SVGSVGElement>) => {
    const endX = eventX(event)
    const startX = dragStart
    setDragStart(null)
    if (startX === null || endX === null) return
    const reference = series[0]
    const pixelSpan = Math.abs(xToPx(endX) - xToPx(startX))
    const setGestureArmed = !!reference && !reference.downsampled

    if (event.ctrlKey || event.metaKey) {
      if (!setGestureArmed) return
      if (pixelSpan < CLICK_PIXEL_THRESHOLD) {
        const target = nearestValueWithinPixels(reference.values, endX, xToPx, SET_HIT_PIXEL_RADIUS)
        if (target) toggleInSet(target.sourceIndex)
      } else {
        const start = nearestValueWithinPixels(reference.values, startX, xToPx, SET_HIT_PIXEL_RADIUS)
        const end = nearestValueWithinPixels(reference.values, endX, xToPx, SET_HIT_PIXEL_RADIUS)
        if (start && end) unionSetRange(start.sourceIndex, end.sourceIndex)
      }
      return
    }

    if (event.shiftKey) {
      if (!setGestureArmed) return
      const target = nearestValueWithinPixels(reference.values, endX, xToPx, SET_HIT_PIXEL_RADIUS)
      if (target) extendSetRange(target.sourceIndex)
      return
    }

    if (pixelSpan < CLICK_PIXEL_THRESHOLD) {
      const target = reference ? nearestValue(reference.values, endX) : null
      if (target) selectPoint(pointIndex === target.sourceIndex ? null : target.sourceIndex)
      return
    }

    if (!xDomain) return
    const lo = Math.max(xDomain.lo, Math.min(startX, endX))
    const hi = Math.min(xDomain.hi, Math.max(startX, endX))
    if (hi > lo) setZoomedDomain({ lo, hi })
  }

  const handleDeleteSet = async () => {
    if (indexSet.length === 0 || !onDeletePoints) return
    const proceed = await confirm({
      title: `Delete ${indexSet.length.toLocaleString()} point(s)`,
      message: 'These points are removed from the track. Every row after a deleted point shifts up by one for each point removed ahead of it.',
      details: [
        `${points.length.toLocaleString()} points → ${(points.length - indexSet.length).toLocaleString()} points`,
        'Undoable from the operation history',
      ],
      confirmLabel: 'Delete',
    })
    if (!proceed) return
    // applyTransform → restorePointSelection clears indexSet once the delete
    // lands, same as the Table's delete button; no extra clearSet() call.
    onDeletePoints(indexSet)
  }

  const exportChart = async (format: 'svg' | 'png') => {
    const svg = svgRef.current
    if (!svg) return
    try {
      const serialized = serializeChartSvg(svg, width, height)
      const blob = format === 'svg'
        ? new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' })
        : await svgStringToPngBlob(serialized, width, height)
      const filename = chartExportFilename(format)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      void archiveFile('outputs', filename, blob)
      logger.success('export', `Exported chart to ${filename}`)
    } catch (error) {
      logger.error('export', `Chart export failed: ${errorMessage(error)}`)
    }
  }

  return (
    <div className="time-series-chart-container">
      <ChartTypeSelector dataset={dataset} currentType={chartType} onSelectType={setChartType} />

      <div className="chart-wrapper">
        {chartTypeMismatch && (
          <div className="chart-mismatch-warning" role="alert">
            <p>
              <strong>⚠ This chart type doesn't match your data.</strong>
              {chartTypeReason ? ` ${chartTypeReason}` : ''}
            </p>
            <button type="button" className="chip" onClick={() => setChartType(recommendedChartType)}>
              Switch to {CHART_TYPE_LABELS[recommendedChartType] ?? recommendedChartType}
            </button>
          </div>
        )}

        <div className="chart">
          <div className="chart-toolbar">
            <label className="chart-xaxis">preset<select value={presetId} onChange={(event) => applyPreset(event.target.value)}>{BUILT_IN_CHART_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
            <div className="chart-channels">{available.map((key) => <button key={key} type="button" className={`chip${selected.includes(key) ? ' chip-on' : ''}`} style={selected.includes(key) ? { borderColor: PALETTE[selected.indexOf(key) % PALETTE.length] } : undefined} onClick={() => toggle(key)}><span className="chip-dot" style={{ background: selected.includes(key) ? PALETTE[selected.indexOf(key) % PALETTE.length] : '#475569' }} />{key}</button>)}</div>
            <label className="chart-xaxis">x-axis<select value={effectiveX} onChange={(event) => { setPresetId('custom'); setXAxis(event.target.value as ChartXAxis); resetZoom() }}>{hasTime && <option value="time">time</option>}<option value="index">index</option>{hasDistance && <option value="distance">distance</option>}{chartType === 'scatter' && available.map((key) => <option key={key} value={`channel:${key}`}>{key} (channel)</option>)}</select></label>
            {pointIndex !== null && <SelectionChip label={`point #${pointIndex}`} onJump={() => zoomToSelection('point')} jumpTitle="Zoom the chart to this point" onClear={clearPointSelection} clearLabel="Clear point selection" />}
            {indexRange && <SelectionChip label={`range ${indexRange.start}–${indexRange.end}`} tone="range" onJump={() => zoomToSelection('range')} jumpTitle="Zoom the chart to this range" onClear={clearRangeSelection} clearLabel="Clear range selection" />}
            {indexSet.length > 0 && <SelectionChip label={`set of ${indexSet.length}`} tone="set" onClear={clearSet} clearLabel="Clear multi-select" />}
            {indexSet.length > 0 && onDeletePoints && <button type="button" onClick={() => void handleDeleteSet()}>Delete {indexSet.length} point(s)</button>}
            {isZoomed && <button type="button" className="chip" onClick={resetZoom}>Reset zoom ×</button>}
            <button type="button" onClick={() => void exportChart('svg')} title="Export the current chart view as a standalone SVG file">Export SVG</button>
            <button type="button" onClick={() => void exportChart('png')} title="Export the current chart view as a PNG image">Export PNG</button>
          </div>

          <svg ref={svgRef} className="chart-svg" viewBox={`0 0 ${width} ${height}`} onMouseMove={(event) => { const x = eventX(event); setHover(x); const nearest = x === null ? null : nearestValue(series[0]?.values ?? [], x); setHoverIndex(nearest?.sourceIndex ?? null); if (dragStart !== null) setDragModifiers({ ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey }) }} onMouseLeave={() => { setHover(null); setDragStart(null); clearHover() }} onMouseDown={onMouseDown} onMouseUp={onMouseUp} style={{ cursor: 'crosshair' }}>
            <defs><clipPath id={plotClipId}><rect x={pad.left} y={pad.top} width={plotW} height={plotH} /></clipPath></defs>
            {[0, 0.25, 0.5, 0.75, 1].map((grid) => <line key={grid} x1={pad.left} x2={width - pad.right} y1={pad.top + grid * plotH} y2={pad.top + grid * plotH} className="chart-grid" />)}
            {rangeX && <rect x={Math.min(xToPx(rangeX.start), xToPx(rangeX.end))} y={pad.top} width={Math.abs(xToPx(rangeX.end) - xToPx(rangeX.start))} height={plotH} fill="rgba(234,79,47,0.12)" />}
            <g clipPath={`url(#${plotClipId})`}>
            {series.map((item) => {
              if (item.values.length < 2) return null
              // Scatter is points-only — no line to connect samples that (per
              // `validator.ts`'s scatter rule) aren't necessarily in a
              // meaningful sequence along this axis. Its circles render below
              // regardless of chart type, so returning null here is enough.
              if (chartType === 'scatter') return null
              const linePath = item.values.map((value, index) => {
                const x = xToPx(value.x)
                const y = yToPx(item, value.y)
                return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
              }).join(' ')
              if (chartType !== 'area') return <path key={item.key} d={linePath} className="chart-line" style={{ stroke: item.color }} />
              const baseline = pad.top + plotH
              const firstX = xToPx(item.values[0]!.x).toFixed(1)
              const lastX = xToPx(item.values[item.values.length - 1]!.x).toFixed(1)
              const areaPath = `${linePath} L${lastX},${baseline} L${firstX},${baseline} Z`
              return (
                <g key={item.key}>
                  <path d={areaPath} fill={item.color} fillOpacity={0.18} stroke="none" />
                  <path d={linePath} className="chart-line" style={{ stroke: item.color }} />
                </g>
              )
            })}
            {series.map((item) => item.downsampled ? null : (
              // Below the render budget every point in the window is present in `item.values`
              // (no bucketing), so a marker here corresponds to a real, individually selectable
              // sample rather than an extrema-preserving stand-in for a bucket of them.
              <g key={`${item.key}-points`}>
                {item.values.map((value) => {
                  const isSelected = value.sourceIndex === pointIndex
                  const isHovered = value.sourceIndex === hoverIndex
                  const isInSet = indexSetLookup.has(value.sourceIndex)
                  return (
                    <circle
                      key={value.sourceIndex}
                      cx={xToPx(value.x)}
                      cy={yToPx(item, value.y)}
                      r={isSelected || isInSet ? 5 : isHovered ? 4 : 2.5}
                      className="chart-point"
                      style={{ fill: item.color, stroke: isSelected ? '#ea4f2f' : isInSet ? '#a855f7' : 'none', strokeWidth: isSelected || isInSet ? 2 : 0 }}
                      pointerEvents="none"
                    />
                  )
                })}
              </g>
            ))}
            </g>
            {xDomain && eventMarkers.map(({ event, x }) => <line key={event.id} x1={xToPx(x)} x2={xToPx(x)} y1={pad.top} y2={pad.top + plotH} className={`chart-event-marker chart-event-${event.severity}`} strokeDasharray={EVENT_SEVERITY_DASH[event.severity]}><title>{`${event.kind} (${event.severity}): ${event.explanation}`}</title></line>)}
            {cursorX !== null && xDomain && <line x1={xToPx(cursorX)} x2={xToPx(cursorX)} y1={pad.top} y2={pad.top + plotH} className="chart-crosshair" />}
            {dragStart !== null && hover !== null && <rect x={Math.min(xToPx(dragStart), xToPx(hover))} y={pad.top} width={Math.abs(xToPx(hover) - xToPx(dragStart))} height={plotH} fill={(dragModifiers.ctrl || dragModifiers.shift) && !series[0]?.downsampled ? 'rgba(168,85,247,0.16)' : 'rgba(59,130,246,0.14)'} />}
            {selectedX !== null && xDomain && <line x1={xToPx(selectedX)} x2={xToPx(selectedX)} y1={pad.top} y2={pad.top + plotH} style={{ stroke: '#ea4f2f', strokeWidth: 2 }} />}
            {series.filter((item) => item.values.length > 1).map((item, row) => { const { min, max } = yRange(item); return <g key={item.key}><text x={4} y={pad.top + 4 + row * 11} className="chart-axis-label" style={{ fill: item.color }}>{item.key} ({channelUnit(item.key)}) max {fmt(max)}</text><text x={4} y={pad.top + plotH - row * 11} className="chart-axis-label" style={{ fill: item.color }}>{item.key} ({channelUnit(item.key)}) min {fmt(min)}</text></g> })}
            {effectiveDomain && <>
              <text x={pad.left} y={height - 7} className="chart-axis-label chart-axis-label--strong" textAnchor="start">{formatX(effectiveDomain.lo, effectiveX)}</text>
              <text x={width - pad.right} y={height - 7} className="chart-axis-label chart-axis-label--strong" textAnchor="end">{formatX(effectiveDomain.hi, effectiveX)}</text>
            </>}
          </svg>

          <div className="chart-readout chart-readout--persistent mono"><span className="chart-readout-x">{cursorX !== null ? `cursor ${formatX(cursorX, effectiveX)}` : 'Move over the plot for point details'}</span>{series.map((item) => { const nearest = cursorX === null ? null : nearestValue(item.values, cursorX); return <span key={item.key} style={{ color: item.color }}>{item.key} ({channelUnit(item.key)}): {nearest ? fmt(nearest.y) : '—'}</span> })}</div>
          {xDomain && <div className="chart-time-range mono"><span>{effectiveX === 'time' ? 'time range' : `${xAxisLabel(effectiveX)} range`}</span><strong>start {formatX(xDomain.lo, effectiveX)}</strong><strong>end {formatX(xDomain.hi, effectiveX)}</strong>{isZoomed && <span>(zoomed view shown above)</span>}</div>}
          {statistics && <div className="chart-readout mono"><strong>{statistics.pointCount.toLocaleString()} pts</strong><span>{fmt(convertDistance(statistics.distanceMeters, unitSystem))} {distanceUnitLabel(unitSystem)}</span>{statistics.durationSeconds !== undefined && <span>{fmt(statistics.durationSeconds)} s</span>}{Object.entries(statistics.channels).map(([id, summary]) => <span key={id}>{id}: μ {fmt(summary.mean)} · {fmt(summary.min)}–{fmt(summary.max)}</span>)}</div>}
          {qualityEvents.length > 0 && <div className="muted small chart-event-legend">⚠ {qualityEvents.length} quality event{qualityEvents.length === 1 ? '' : 's'} detected (solid = error, dashed = warning, dotted = info) — hover a marker for details.</div>}
          <div className="muted small">
            Click to select a point; drag to zoom; wheel to zoom, shift+wheel (or a trackpad swipe) to pan. Ctrl/⌘+wheel zooms the Y axis, ctrl/⌘+shift+wheel pans it.
            {series[0] && !series[0].downsampled
              ? ' Ctrl/⌘+click or +drag adds points to a delete set, shift+click extends it.'
              : ' Zoom in until individual points render to build a delete set.'}
            {' '}Rendering up to {chartPointBudget.toLocaleString()} extrema-preserving samples per channel (adjustable in Settings).
          </div>
        </div>

        <ChartLegend dataset={dataset} visibleChannels={visibleChannels} onToggleChannel={handleToggleChannel} />
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function pointX(point: TrackPoint | undefined, index: number, axis: ChartXAxis): number | null {
  if (!point) return null
  if (axis === 'time') return point.time ?? null
  if (axis === 'distance') return typeof point.ext?.distance_m === 'number' ? point.ext.distance_m : null
  const channelId = channelIdFromXAxis(axis)
  if (channelId !== null) return numericChannelValue(point, channelId)
  return index
}

function nearestValue(values: SeriesValue[], x: number): SeriesValue | null {
  if (values.length === 0) return null
  let best = values[0]!
  let bestDistance = Math.abs(best.x - x)
  for (const value of values) {
    const distance = Math.abs(value.x - x)
    if (distance < bestDistance) {
      bestDistance = distance
      best = value
    }
  }
  return best
}

/** Like `nearestValue`, but rejects a match that isn't within `maxPx` screen
 *  pixels of `x` — see the `SET_HIT_PIXEL_RADIUS` comment for why the
 *  delete-set gestures need this and plain point-selection does not. */
function nearestValueWithinPixels(values: SeriesValue[], x: number, xToPx: (x: number) => number, maxPx: number): SeriesValue | null {
  const nearest = nearestValue(values, x)
  if (!nearest) return null
  return Math.abs(xToPx(nearest.x) - xToPx(x)) <= maxPx ? nearest : null
}

function formatX(value: number, axis: ChartXAxis): string {
  if (axis === 'time') return epochMsToIso(value)
  if (axis === 'distance') return `${fmt(value)} m`
  const channelId = channelIdFromXAxis(axis)
  if (channelId !== null) return `${fmt(value)} ${channelUnit(channelId)}`
  return `index ${Math.round(value)}`
}

/** Display label for an axis: the bare channel name for a `channel:` axis, the axis id itself otherwise. */
function xAxisLabel(axis: ChartXAxis): string {
  return channelIdFromXAxis(axis) ?? axis
}

function channelUnit(key: string): string {
  if (key === 'elevation') return 'm'
  if (key.endsWith('_mps')) return 'm/s'
  if (key.endsWith('_mps2')) return 'm/s²'
  if (key.endsWith('_deg')) return '°'
  if (key.endsWith('_dps')) return '°/s'
  if (key.endsWith('_m')) return 'm'
  if (key.endsWith('_hz')) return 'Hz'
  if (key === 'hdop' || key === 'vdop' || key === 'pdop') return 'DOP'
  if (key === 'sat') return 'sats'
  return 'value'
}

function fmt(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0)
  if (Math.abs(value) >= 1) return value.toFixed(2)
  return value.toFixed(4)
}
