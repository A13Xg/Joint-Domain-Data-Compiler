import { useEffect, useMemo, useState } from 'react'
import type { LatLngBoundsExpression, LatLngTuple } from 'leaflet'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { TrackPoint } from '../core/model'
import { isValidLat, isValidLon } from '../core/model'
import { epochMsToIso } from '../core/format'
import { usePointSelection } from '../state/pointSelection'

type DisplayMode = 'both' | 'path' | 'points'
const MAX_RENDER_POINTS = 4000

function FitBounds({ positions }: { positions: LatLngTuple[] }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length > 0) map.fitBounds(positions as LatLngBoundsExpression, { padding: [28, 28], maxZoom: 16 })
  }, [map, positions])
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

export function MapView({ points, channels }: { points: TrackPoint[]; channels: string[] }) {
  const [mode, setMode] = useState<DisplayMode>('both')
  const [colorBy, setColorBy] = useState('none')
  const { pointIndex, selectPoint, clearSelection } = usePointSelection(points)

  const valid = useMemo(
    () => points.map((point, index) => ({ point, index })).filter(({ point }) => isValidLat(point.lat) && isValidLon(point.lon)),
    [points],
  )
  const rendered = useMemo(() => {
    if (valid.length <= MAX_RENDER_POINTS) return valid
    const step = Math.ceil(valid.length / MAX_RENDER_POINTS)
    return valid.filter((_, index) => index % step === 0)
  }, [valid])
  const positions = useMemo<LatLngTuple[]>(() => rendered.map(({ point }) => [point.lat, point.lon]), [rendered])
  const colorChannels = useMemo(() => ['none', 'elevation', ...channels.filter((channel) => channel !== 'elevation')], [channels])
  const colorRange = useMemo(() => {
    if (colorBy === 'none') return null
    const values = rendered.map(({ point }) => channelValue(point, colorBy)).filter((value): value is number => value !== null)
    return values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : null
  }, [rendered, colorBy])

  if (valid.length === 0) return <div className="map-empty">No valid coordinates to display.</div>

  return (
    <div className="map-view">
      <div className="map-toolbar">
        <label>display<select value={mode} onChange={(event) => setMode(event.target.value as DisplayMode)}><option value="both">Path + Points</option><option value="path">Path only</option><option value="points">Points only</option></select></label>
        <label>color by<select value={colorBy} onChange={(event) => setColorBy(event.target.value)}>{colorChannels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}</select></label>
        <span className="map-meta">{valid.length.toLocaleString()} valid pts{rendered.length < valid.length && ` · ${rendered.length.toLocaleString()} drawn`}</span>
        {pointIndex !== null && <button type="button" className="chip chip-on" onClick={clearSelection}>selected #{pointIndex} ×</button>}
        {colorRange && <span className="map-legend"><span style={{ background: gradientColor(0) }} /> {fmt(colorRange.min)}<span style={{ background: gradientColor(0.5) }} /><span style={{ background: gradientColor(1) }} /> {fmt(colorRange.max)}</span>}
      </div>
      <div className="map-canvas-wrap">
        <MapContainer center={positions[0]} zoom={10} className="map-canvas" scrollWheelZoom>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {mode !== 'points' && <Polyline positions={positions} pathOptions={{ color: '#ea4f2f', weight: 2.5, opacity: 0.85 }} />}
          {mode !== 'path' && rendered.map(({ point, index }) => {
            const selected = pointIndex === index
            let color = selected ? '#ea4f2f' : '#0f8c6f'
            if (!selected && colorRange && colorBy !== 'none') {
              const value = channelValue(point, colorBy)
              if (value !== null) color = gradientColor((value - colorRange.min) / (colorRange.max - colorRange.min || 1))
            }
            return (
              <CircleMarker
                key={`${index}-${point.lat}-${point.lon}`}
                center={[point.lat, point.lon]}
                radius={selected ? 7 : 2.8}
                pathOptions={{ color, fillColor: color, fillOpacity: selected ? 1 : 0.75, weight: selected ? 2 : 0 }}
                eventHandlers={{ click: () => selectPoint(selected ? null : index) }}
              >
                <Tooltip>
                  <div className="map-tip mono"><div>#{index} · {point.lat.toFixed(6)}, {point.lon.toFixed(6)}</div>{point.ele !== undefined && <div>ele {point.ele.toFixed(1)} m</div>}{point.time !== undefined && <div>{epochMsToIso(point.time)}</div>}{point.name && <div>{point.name}</div>}{colorBy !== 'none' && channelValue(point, colorBy) !== null && <div>{colorBy}: {fmt(channelValue(point, colorBy)!)}</div>}</div>
                </Tooltip>
              </CircleMarker>
            )
          })}
          <CircleMarker center={positions[0]} radius={6} pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.9, weight: 1 }}><Tooltip>start</Tooltip></CircleMarker>
          <CircleMarker center={positions[positions.length - 1]} radius={6} pathOptions={{ color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.9, weight: 1 }}><Tooltip>end</Tooltip></CircleMarker>
          <FitBounds positions={positions} />
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

function fmt(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0)
  if (Math.abs(value) >= 1) return value.toFixed(1)
  return value.toFixed(3)
}
