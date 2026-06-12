// Interactive Leaflet map of the active track. Supports path/points/both display
// modes and gradient coloring by any numeric channel (elevation, speed, ...),
// with downsampling so dense TSPI tracks stay responsive.
import { useEffect, useMemo, useState } from 'react'
import type { LatLngBoundsExpression, LatLngTuple } from 'leaflet'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { TrackPoint } from '../core/model'
import { isValidLat, isValidLon } from '../core/model'
import { epochMsToIso } from '../core/format'

type DisplayMode = 'both' | 'path' | 'points'

const MAX_RENDER_POINTS = 4000

function FitBounds({ positions }: { positions: LatLngTuple[] }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length === 0) return
    const bounds: LatLngBoundsExpression = positions
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 })
  }, [map, positions])
  return null
}

function gradientColor(t: number): string {
  // viridis-ish blue→green→yellow gradient for channel coloring.
  const stops = [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ]
  const clamped = Math.max(0, Math.min(1, t))
  const seg = clamped * (stops.length - 1)
  const i = Math.floor(seg)
  const f = seg - i
  const a = stops[i]
  const b = stops[Math.min(stops.length - 1, i + 1)]
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

export function MapView({
  points,
  channels,
}: {
  points: TrackPoint[]
  channels: string[]
}) {
  const [mode, setMode] = useState<DisplayMode>('both')
  const [colorBy, setColorBy] = useState<string>('none')

  const valid = useMemo(
    () => points.filter((p) => isValidLat(p.lat) && isValidLon(p.lon)),
    [points],
  )

  const rendered = useMemo(() => {
    if (valid.length <= MAX_RENDER_POINTS) return valid
    const step = Math.ceil(valid.length / MAX_RENDER_POINTS)
    return valid.filter((_, i) => i % step === 0)
  }, [valid])

  const positions = useMemo<LatLngTuple[]>(
    () => rendered.map((p) => [p.lat, p.lon]),
    [rendered],
  )

  const colorChannels = useMemo(
    () => ['none', 'elevation', ...channels.filter((c) => c !== 'elevation')],
    [channels],
  )

  const colorRange = useMemo(() => {
    if (colorBy === 'none') return null
    const values = rendered.map((p) => channelValue(p, colorBy)).filter((v): v is number => v !== null)
    if (values.length === 0) return null
    return { min: Math.min(...values), max: Math.max(...values) }
  }, [rendered, colorBy])

  if (valid.length === 0) {
    return <div className="map-empty">No valid coordinates to display.</div>
  }

  return (
    <div className="map-view">
      <div className="map-toolbar">
        <label>
          display
          <select value={mode} onChange={(e) => setMode(e.target.value as DisplayMode)}>
            <option value="both">Path + Points</option>
            <option value="path">Path only</option>
            <option value="points">Points only</option>
          </select>
        </label>
        <label>
          color by
          <select value={colorBy} onChange={(e) => setColorBy(e.target.value)}>
            {colorChannels.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <span className="map-meta">
          {valid.length.toLocaleString()} valid pts
          {rendered.length < valid.length && ` · ${rendered.length.toLocaleString()} drawn`}
        </span>
        {colorRange && (
          <span className="map-legend">
            <span style={{ background: gradientColor(0) }} /> {fmt(colorRange.min)}
            <span style={{ background: gradientColor(0.5) }} />
            <span style={{ background: gradientColor(1) }} /> {fmt(colorRange.max)}
          </span>
        )}
      </div>
      <div className="map-canvas-wrap">
        <MapContainer center={positions[0]} zoom={10} className="map-canvas" scrollWheelZoom>
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {mode !== 'points' && (
            <Polyline positions={positions} pathOptions={{ color: '#ea4f2f', weight: 2.5, opacity: 0.85 }} />
          )}
          {mode !== 'path' &&
            rendered.map((p, i) => {
              let color = '#0f8c6f'
              if (colorRange && colorBy !== 'none') {
                const v = channelValue(p, colorBy)
                if (v !== null) {
                  const span = colorRange.max - colorRange.min || 1
                  color = gradientColor((v - colorRange.min) / span)
                }
              }
              return (
                <CircleMarker
                  key={`${p.lat}-${p.lon}-${i}`}
                  center={[p.lat, p.lon]}
                  radius={2.8}
                  pathOptions={{ color, fillColor: color, fillOpacity: 0.75, weight: 0 }}
                >
                  <Tooltip>
                    <div className="map-tip mono">
                      <div>{p.lat.toFixed(6)}, {p.lon.toFixed(6)}</div>
                      {p.ele !== undefined && <div>ele {p.ele.toFixed(1)} m</div>}
                      {p.time !== undefined && <div>{epochMsToIso(p.time)}</div>}
                      {p.name && <div>{p.name}</div>}
                      {colorBy !== 'none' && channelValue(p, colorBy) !== null && (
                        <div>{colorBy}: {fmt(channelValue(p, colorBy)!)}</div>
                      )}
                    </div>
                  </Tooltip>
                </CircleMarker>
              )
            })}
          {/* Start / end emphasis markers */}
          <CircleMarker center={positions[0]} radius={6} pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.9, weight: 1 }}>
            <Tooltip permanent={false}>start</Tooltip>
          </CircleMarker>
          <CircleMarker center={positions[positions.length - 1]} radius={6} pathOptions={{ color: '#dc2626', fillColor: '#dc2626', fillOpacity: 0.9, weight: 1 }}>
            <Tooltip permanent={false}>end</Tooltip>
          </CircleMarker>
          <FitBounds positions={positions} />
        </MapContainer>
      </div>
    </div>
  )
}

function channelValue(p: TrackPoint, key: string): number | null {
  if (key === 'elevation') return p.ele ?? null
  const v = p.ext?.[key]
  if (v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0)
  if (Math.abs(n) >= 1) return n.toFixed(1)
  return n.toFixed(3)
}
