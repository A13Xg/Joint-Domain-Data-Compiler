import { useMemo, useState } from 'react'
import type { Dataset } from '../core/model'
import { buildTrajectory3dGeometry } from '../visualization/scene3d/trajectory'
import { usePointSelection } from '../state/pointSelection'

export function Trajectory3dPanel({ dataset }: { dataset: Dataset }) {
  const [altitudeExaggeration, setAltitudeExaggeration] = useState(1)
  const [yawDeg, setYawDeg] = useState(-35)
  const [pitchDeg, setPitchDeg] = useState(28)
  const [colorChannelId, setColorChannelId] = useState('')
  const { pointIndex, selectPoint } = usePointSelection(dataset.points)

  const geometry = useMemo(() => buildTrajectory3dGeometry(dataset.points, { altitudeExaggeration, maxPoints: 8000, colorChannelId: colorChannelId || undefined }), [dataset.points, altitudeExaggeration, colorChannelId])
  const projected = useMemo(() => projectVertices(geometry.vertices, yawDeg, pitchDeg, 920, 520), [geometry.vertices, yawDeg, pitchDeg])
  const selected = pointIndex === null ? null : projected.find((vertex) => vertex.sourceIndex === pointIndex) ?? null

  return (
    <div className="analysis-panel trajectory-panel">
      <div className="analysis-toolbar">
        <label className="num-field"><span>altitude exaggeration</span><input type="number" min={0.1} step={0.5} value={altitudeExaggeration} onChange={(event) => setAltitudeExaggeration(Math.max(0.1, Number(event.target.value) || 1))} /></label>
        <label className="num-field"><span>yaw°</span><input type="range" min={-180} max={180} value={yawDeg} onChange={(event) => setYawDeg(Number(event.target.value))} /></label>
        <label className="num-field"><span>pitch°</span><input type="range" min={-80} max={80} value={pitchDeg} onChange={(event) => setPitchDeg(Number(event.target.value))} /></label>
        <label className="num-field"><span>color channel</span><select value={colorChannelId} onChange={(event) => setColorChannelId(event.target.value)}><option value="">single color</option><option value="elevation">elevation</option>{dataset.channels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}</select></label>
      </div>
      <svg className="trajectory-svg" viewBox="0 0 920 520" role="img" aria-label="Local ENU trajectory preview" onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const x = ((event.clientX - rect.left) / rect.width) * 920
        const y = ((event.clientY - rect.top) / rect.height) * 520
        const nearest = projected.reduce<{ sourceIndex: number; distance: number } | null>((best, vertex) => {
          const distance = Math.hypot(vertex.x - x, vertex.y - y)
          return !best || distance < best.distance ? { sourceIndex: vertex.sourceIndex, distance } : best
        }, null)
        if (nearest && nearest.distance < 24) selectPoint(nearest.sourceIndex)
      }}>
        <rect width="920" height="520" className="trajectory-bg" />
        <line x1="50" y1="470" x2="870" y2="470" className="trajectory-grid" />
        <line x1="70" y1="60" x2="70" y2="470" className="trajectory-grid" />
        {projected.length > 1 && <path d={projected.map((vertex, index) => `${index === 0 ? 'M' : 'L'}${vertex.x.toFixed(1)},${vertex.y.toFixed(1)}`).join(' ')} className="trajectory-path" />}
        {colorChannelId && geometry.colorRange && projected.map((vertex) => vertex.colorValue === undefined ? null : <circle key={vertex.sourceIndex} cx={vertex.x} cy={vertex.y} r="2.2" fill={gradient(vertex.colorValue, geometry.colorRange.min, geometry.colorRange.max)} />)}
        {selected && <circle cx={selected.x} cy={selected.y} r="7" className="trajectory-selected" />}
        <text x="80" y="78" className="chart-axis-label">UP</text><text x="700" y="495" className="chart-axis-label">LOCAL ENU PROJECTION</text>
      </svg>
      <div className="metric-grid">
        <Metric label="source points" value={geometry.sourcePointCount.toLocaleString()} />
        <Metric label="valid coordinates" value={geometry.validPointCount.toLocaleString()} />
        <Metric label="rendered vertices" value={geometry.renderedPointCount.toLocaleString()} />
        <Metric label="east span" value={`${format(geometry.bounds.maxEastM - geometry.bounds.minEastM)} m`} />
        <Metric label="north span" value={`${format(geometry.bounds.maxNorthM - geometry.bounds.minNorthM)} m`} />
        <Metric label="up span" value={`${format(geometry.bounds.maxUpM - geometry.bounds.minUpM)} m`} />
      </div>
      <div className="muted small">Click near the trajectory to synchronize the selected source point with the chart, map, and table. The view uses the production WGS84/ECEF/ENU geometry layer and can later be replaced by React Three Fiber without changing coordinate semantics.</div>
    </div>
  )
}

function projectVertices(vertices: ReturnType<typeof buildTrajectory3dGeometry>['vertices'], yawDeg: number, pitchDeg: number, width: number, height: number) {
  const yaw = yawDeg * Math.PI / 180
  const pitch = pitchDeg * Math.PI / 180
  const rotated = vertices.map((vertex) => {
    const x1 = vertex.eastM * Math.cos(yaw) - vertex.northM * Math.sin(yaw)
    const y1 = vertex.eastM * Math.sin(yaw) + vertex.northM * Math.cos(yaw)
    return { ...vertex, px: x1, py: y1 * Math.cos(pitch) - vertex.upM * Math.sin(pitch) }
  })
  const xs = rotated.map((vertex) => vertex.px)
  const ys = rotated.map((vertex) => vertex.py)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const scale = Math.min((width - 100) / (maxX - minX || 1), (height - 100) / (maxY - minY || 1))
  return rotated.map((vertex) => ({ ...vertex, x: 50 + (vertex.px - minX) * scale, y: height - 50 - (vertex.py - minY) * scale }))
}

function gradient(value: number, min: number, max: number): string { const ratio = max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min))); return `hsl(${220 - ratio * 210} 78% 58%)` }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric-card"><span className="metric-label">{label}</span><strong className="mono">{value}</strong></div> }
function format(value: number): string { return Math.abs(value) >= 1000 ? value.toFixed(0) : value.toFixed(1) }
