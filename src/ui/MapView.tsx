import { useEffect, useMemo, useState } from 'react'
import type { LatLngBoundsExpression, LatLngTuple } from 'leaflet'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { TrackPoint } from '../core/model'
import { isValidLat, isValidLon } from '../core/model'
import { epochMsToIso } from '../core/format'
import { DEFAULT_QUALITY_EVENT_CONFIG, detectQualityEvents } from '../core/quality/events'
import { usePointSelection } from '../state/pointSelection'
import type { WorkspaceState } from '../state/workspace'
import type { MapOverlayState } from '../state/mapOverlays'
import { MapOverlayPanel } from './MapOverlayPanel'

type DisplayMode = 'both' | 'path' | 'points'
type BasemapMode = 'osm' | 'none'
const MAX_RENDER_POINTS = 4000

/** A non-active, visible dataset rendered as a plain color-coded path (Task 5.2: multi-track map rendering). Path-only and non-interactive — active-track selection/hover/quality markers are unaffected. */
export interface OtherTrack {
  id: string
  name: string
  color: string
  points: TrackPoint[]
  /** Line opacity override, used by KML/KMZ map overlays (Task 1.4); other visible datasets keep the default. */
  opacity?: number
}

function FitBounds({ positions, request }: { positions: LatLngTuple[]; request: number }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length > 0) map.fitBounds(positions as LatLngBoundsExpression, { padding: [28, 28], maxZoom: 16 })
  }, [map, positions, request])
  return null
}

function gradientColor(value: number): string {
  const stops = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]
  const clamped = Math.max(0, Math.min(1, value))
  const segment = clamped * (stops.length - 1)
  const index = Math.floor(segment)
  const fraction = segment - index
  const start = stops[index]!
  const end = stops[Math.min(stops.length - 1, index + 1)]!
  const color = start.map((component, componentIndex) => Math.round(component + (end[componentIndex]! - component) * fraction))
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`
}

function downsample<T>(values: T[], maxPoints: number): T[] {
  if (values.length <= maxPoints) return values
  // Reserve one slot for the final point so the render budget is a strict
  // maximum rather than maxPoints plus a trailing endpoint.
  const step = Math.ceil((values.length - 1) / (maxPoints - 1))
  const sampled = values.filter((_, index) => index % step === 0)
  if (sampled[sampled.length - 1] !== values[values.length - 1]) sampled.push(values[values.length - 1]!)
  return sampled
}

type BasemapStatus = 'unknown' | 'loaded' | 'error'

export function MapView({ points, channels, workspace, onWorkspaceChange, otherTracks = [], overlayState, onOverlayStateChange, onImportOverlayAsTrack }: {
  points: TrackPoint[]
  channels: string[]
  workspace: WorkspaceState['map']
  onWorkspaceChange: (next: WorkspaceState['map']) => void
  otherTracks?: OtherTrack[]
  overlayState: MapOverlayState
  onOverlayStateChange: (next: MapOverlayState) => void
  onImportOverlayAsTrack: (name: string, text: string, sourceBytes?: number) => void
}) {
  const { displayMode: mode, colorBy, basemap, maxGapMinutes } = workspace
  const [fitRequest, setFitRequest] = useState(0)
  const [fitSelection, setFitSelection] = useState(false)
  const [basemapStatus, setBasemapStatus] = useState<BasemapStatus>('unknown')
  // Reset the status during render when the basemap choice changes, rather
  // than in an effect — the officially-recommended pattern for resetting
  // state in response to a prop/derived-value change (react.dev: "Resetting
  // state when a prop changes").
  const [trackedBasemap, setTrackedBasemap] = useState(basemap)
  if (basemap !== trackedBasemap) {
    setTrackedBasemap(basemap)
    setBasemapStatus('unknown')
  }
  const { pointIndex, hoverIndex, indexRange, selectPoint, setHoverIndex, clearPointSelection, clearRangeSelection, clearHover } = usePointSelection(points)

  const valid = useMemo(
    () => points.map((point, index) => ({ point, index })).filter(({ point }) => isValidLat(point.lat) && isValidLon(point.lon)),
    [points],
  )
  const rendered = useMemo(() => downsample(valid, MAX_RENDER_POINTS), [valid])
  const selectedValid = useMemo(
    () => indexRange ? valid.filter(({ index }) => index >= indexRange.start && index <= indexRange.end) : [],
    [valid, indexRange],
  )
  const renderedSelection = useMemo(() => downsample(selectedValid, MAX_RENDER_POINTS), [selectedValid])
  const positions = useMemo<LatLngTuple[]>(() => rendered.map(({ point }) => [point.lat, point.lon]), [rendered])
  const qualityEvents = useMemo(() => detectQualityEvents(points, { ...DEFAULT_QUALITY_EVENT_CONFIG, gapMs: Math.max(1, maxGapMinutes * 60_000) }), [points, maxGapMinutes])
  const pathBreakIndices = useMemo(() => new Set(qualityEvents.filter((event) => event.kind === 'gap' || event.kind === 'coordinate-jump').map((event) => event.endIndex)), [qualityEvents])
  const qualityMarkers = useMemo(() => qualityEvents.filter((event) => (event.kind === 'gap' || event.kind === 'coordinate-jump') && isValidLat(points[event.endIndex]?.lat ?? NaN) && isValidLon(points[event.endIndex]?.lon ?? NaN)), [qualityEvents, points])
  const pathSegments = useMemo(() => splitPathSegments(rendered, pathBreakIndices), [rendered, pathBreakIndices])
  const selectionPositions = useMemo<LatLngTuple[]>(() => renderedSelection.map(({ point }) => [point.lat, point.lon]), [renderedSelection])
  const hoveredPoint = hoverIndex === null ? null : points[hoverIndex]
  const hoveredPosition: LatLngTuple | null = hoveredPoint && isValidLat(hoveredPoint.lat) && isValidLon(hoveredPoint.lon) ? [hoveredPoint.lat, hoveredPoint.lon] : null
  const [fitVisible, setFitVisible] = useState(false)

  // Other visible datasets rendered as plain, non-interactive color-coded
  // paths (Task 5.2). Downsampled the same way as the active track.
  const otherTrackLayers = useMemo(() => otherTracks.map((track) => {
    const validPoints = track.points.filter((point) => isValidLat(point.lat) && isValidLon(point.lon))
    const sampled = downsample(validPoints, MAX_RENDER_POINTS)
    return { id: track.id, name: track.name, color: track.color, opacity: track.opacity, positions: sampled.map((point): LatLngTuple => [point.lat, point.lon]) }
  }), [otherTracks])
  const mapPositions = positions.length > 0 ? positions : otherTrackLayers.flatMap((track) => track.positions)

  const fitPositions = fitSelection && selectionPositions.length > 0
    ? selectionPositions
    : fitVisible
      ? [...positions, ...otherTrackLayers.flatMap((track) => track.positions)]
      : positions
  const colorChannels = useMemo(() => ['none', 'elevation', ...channels.filter((channel) => channel !== 'elevation')], [channels])
  const colorRange = useMemo(() => {
    if (colorBy === 'none') return null
    const values = rendered.map(({ point }) => channelValue(point, colorBy)).filter((value): value is number => value !== null)
    return values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : null
  }, [rendered, colorBy])

  const overlayPanel = <MapOverlayPanel overlayState={overlayState} onOverlayStateChange={onOverlayStateChange} onImportAsTrack={onImportOverlayAsTrack} />

  if (mapPositions.length === 0) {
    return (
      <div className="map-view">
        {overlayPanel}
        <div className="map-empty">No valid coordinates to display.</div>
      </div>
    )
  }

  return (
    <div className="map-view">
      {overlayPanel}
      <div className="map-toolbar">
        <label>display<select value={mode} onChange={(event) => onWorkspaceChange({ ...workspace, displayMode: event.target.value as DisplayMode })}><option value="both">Path + Points</option><option value="path">Path only</option><option value="points">Points only</option></select></label>
        <label>basemap<select value={basemap} onChange={(event) => onWorkspaceChange({ ...workspace, basemap: event.target.value as BasemapMode })}><option value="osm">OpenStreetMap</option><option value="none">offline grid</option></select></label>
        <label>color by<select value={colorBy} onChange={(event) => onWorkspaceChange({ ...workspace, colorBy: event.target.value })}>{colorChannels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}</select></label>
        <label>split gaps<input type="number" min={0} step={1} value={maxGapMinutes} onChange={(event) => onWorkspaceChange({ ...workspace, maxGapMinutes: Math.max(0, Number(event.target.value) || 0) })} /> min</label>
        <button type="button" onClick={() => { setFitSelection(false); setFitVisible(false); setFitRequest((value) => value + 1) }}>Fit active</button>
        {otherTrackLayers.length > 0 && <button type="button" onClick={() => { setFitSelection(false); setFitVisible(true); setFitRequest((value) => value + 1) }}>Fit visible ({otherTrackLayers.length + 1})</button>}
        <button type="button" disabled={!indexRange || selectionPositions.length === 0} onClick={() => { setFitSelection(true); setFitVisible(false); setFitRequest((value) => value + 1) }}>Fit range</button>
        <span className="map-meta">{valid.length.toLocaleString()} valid pts{rendered.length < valid.length && ` · ${rendered.length.toLocaleString()} drawn`}</span>
        {pointIndex !== null && <button type="button" className="chip chip-on" onClick={clearPointSelection}>selected #{pointIndex} ×</button>}
        {indexRange && <button type="button" className="chip chip-range" onClick={clearRangeSelection}>range {indexRange.start}–{indexRange.end} ×</button>}
        {colorRange && <span className="map-legend"><span style={{ background: gradientColor(0) }} /> {fmt(colorRange.min)}<span style={{ background: gradientColor(0.5) }} /><span style={{ background: gradientColor(1) }} /> {fmt(colorRange.max)}</span>}
        {basemap === 'osm' && basemapStatus === 'error' && <span className="map-basemap-status map-basemap-error">⚠ Basemap tiles failed to load (offline?) — track data is still fully usable. <button type="button" onClick={() => onWorkspaceChange({ ...workspace, basemap: 'none' })}>Switch to offline grid</button></span>}
        {basemap === 'osm' && basemapStatus === 'unknown' && <span className="map-basemap-status muted small">Basemap requires network access; local track data does not.</span>}
        {otherTrackLayers.length > 0 && <span className="map-legend map-other-tracks">other visible:{otherTrackLayers.map((track) => <span key={track.id} className="map-other-track-chip"><span className="chip-dot" style={{ background: track.color }} />{track.name}</span>)}</span>}
      </div>
      <div className="map-canvas-wrap">
        <MapContainer center={mapPositions[0]} zoom={10} className="map-canvas" scrollWheelZoom>
          {basemap === 'osm' && <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" eventHandlers={{ tileerror: () => setBasemapStatus('error'), tileload: () => setBasemapStatus('loaded') }} />}
          {otherTrackLayers.map((track) => track.positions.length > 1 && <Polyline key={track.id} positions={track.positions} pathOptions={{ color: track.color, weight: 2, opacity: track.opacity ?? 0.6, dashArray: '1 4' }}><Tooltip>{track.name}</Tooltip></Polyline>)}
          {mode !== 'points' && pathSegments.map((segment, index) => <Polyline key={index} positions={segment} pathOptions={{ color: indexRange ? '#64748b' : '#ea4f2f', weight: 2.5, opacity: indexRange ? 0.45 : 0.85 }} />)}
          {mode !== 'points' && selectionPositions.length > 1 && <Polyline positions={selectionPositions} pathOptions={{ color: '#facc15', weight: 5, opacity: 0.95 }} />}
          {qualityMarkers.map((event) => { const point = points[event.endIndex]!; const jump = event.kind === 'coordinate-jump'; return <CircleMarker key={event.id} center={[point.lat, point.lon]} radius={jump ? 7 : 5} pathOptions={{ color: jump ? '#ef4444' : '#f59e0b', fillColor: jump ? '#ef4444' : '#f59e0b', fillOpacity: 0.25, weight: 2, dashArray: jump ? '3 2' : undefined }}><Tooltip><strong>{event.kind === 'gap' ? 'Data gap' : 'Coordinate jump'}</strong><div>{event.explanation}</div></Tooltip></CircleMarker> })}
          {mode !== 'path' && rendered.map(({ point, index }) => {
            const selected = pointIndex === index
            const hovered = hoverIndex === index
            const inRange = indexRange !== null && index >= indexRange.start && index <= indexRange.end
            const notional = point.ext?.notional === true
            let color = selected ? '#ea4f2f' : hovered ? '#38bdf8' : inRange ? '#facc15' : notional ? '#94a3b8' : '#0f8c6f'
            if (!selected && !hovered && !inRange && !notional && colorRange && colorBy !== 'none') {
              const value = channelValue(point, colorBy)
              if (value !== null) color = gradientColor((value - colorRange.min) / (colorRange.max - colorRange.min || 1))
            }
            return (
              <CircleMarker
                key={`${index}-${point.lat}-${point.lon}`}
                center={[point.lat, point.lon]}
                radius={selected ? 7 : hovered ? 6 : inRange ? 4.2 : notional ? 3.2 : 2.8}
                pathOptions={{ color, fillColor: color, fillOpacity: selected || hovered || inRange ? 1 : notional ? 0.5 : 0.75, weight: selected ? 2 : hovered ? 2 : inRange ? 1 : notional ? 1.5 : 0, dashArray: notional ? '2 2' : undefined }}
                eventHandlers={{ click: () => selectPoint(selected ? null : index), mouseover: () => setHoverIndex(index), mouseout: clearHover }}
              >
                <Tooltip>
                  <div className="map-tip mono"><div>#{index} · {point.lat.toFixed(6)}, {point.lon.toFixed(6)}</div>{notional && <div>⚠ notional (interpolated, not observed)</div>}{inRange && <div>selected range</div>}{point.ele !== undefined && <div>ele {point.ele.toFixed(1)} m</div>}{point.time !== undefined && <div>{epochMsToIso(point.time)}</div>}{point.name && <div>{point.name}</div>}{colorBy !== 'none' && channelValue(point, colorBy) !== null && <div>{colorBy}: {fmt(channelValue(point, colorBy)!)}</div>}</div>
                </Tooltip>
              </CircleMarker>
            )
          })}
          {hoveredPosition && <CircleMarker center={hoveredPosition} radius={7} pathOptions={{ color: '#ffffff', fillColor: '#38bdf8', fillOpacity: 0.95, weight: 2 }}><Tooltip>cursor #{hoverIndex}</Tooltip></CircleMarker>}
          <CircleMarker center={positions[0]} radius={6} pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.9, weight: 1 }}><Tooltip>start</Tooltip></CircleMarker>
          <CircleMarker center={positions[positions.length - 1]} radius={6} pathOptions={{ color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.9, weight: 1 }}><Tooltip>end</Tooltip></CircleMarker>
          <FitBounds positions={fitPositions} request={fitRequest} />
        </MapContainer>
      </div>
    </div>
  )
}

function channelValue(point: TrackPoint, key: string): number | null {
  if (key === 'elevation') return point.ele ?? null
  const value = point.ext?.[key]
  if (value === undefined) return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function splitPathSegments(values: Array<{ point: TrackPoint; index: number }>, breakIndices: ReadonlySet<number>): LatLngTuple[][] {
  const segments: LatLngTuple[][] = []
  let current: LatLngTuple[] = []
  let previous: TrackPoint | null = null
  for (const { point, index } of values) {
    const antimeridianJump = previous ? Math.abs(point.lon - previous.lon) > 180 : false
    if (current.length > 0 && (antimeridianJump || breakIndices.has(index))) {
      if (current.length > 1) segments.push(current)
      current = []
    }
    current.push([point.lat, point.lon])
    previous = point
  }
  if (current.length > 1) segments.push(current)
  return segments
}

function fmt(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0)
  if (Math.abs(value) >= 1) return value.toFixed(1)
  return value.toFixed(3)
}
