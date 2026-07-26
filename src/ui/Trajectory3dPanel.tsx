import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Dataset } from '../core/model'
import { buildTrajectory3dGeometry, type Trajectory3dVertex } from '../visualization/scene3d/trajectory'
import { usePointSelection } from '../state/pointSelection'

type ProjectionMode = 'perspective' | 'orthographic'
interface CameraState { yaw: number; pitch: number; zoom: number; panX: number; panY: number }
interface ScreenVertex extends Trajectory3dVertex { x: number; y: number; depth: number }

const DEFAULT_CAMERA: CameraState = { yaw: -0.65, pitch: 0.48, zoom: 1, panX: 0, panY: 0 }

export function Trajectory3dPanel({ dataset }: { dataset: Dataset }) {
  const [altitudeExaggeration, setAltitudeExaggeration] = useState(1)
  const [colorChannelId, setColorChannelId] = useState('')
  const [projection, setProjection] = useState<ProjectionMode>('perspective')
  const [showGrid, setShowGrid] = useState(true)
  const [showCurtain, setShowCurtain] = useState(false)
  const [showPoints, setShowPoints] = useState(true)
  const [autoRotate, setAutoRotate] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playbackFraction, setPlaybackFraction] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [followPlayback, setFollowPlayback] = useState(false)
  const [camera, setCamera] = useState<CameraState>(DEFAULT_CAMERA)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ x: number; y: number; mode: 'orbit' | 'pan'; moved: boolean } | null>(null)
  const projectedRef = useRef<ScreenVertex[]>([])
  const { pointIndex, indexRange, selectPoint, clearSelection, clearRange } = usePointSelection(dataset.points)

  const geometry = useMemo(
    () => buildTrajectory3dGeometry(dataset.points, { altitudeExaggeration, maxPoints: 20_000, colorChannelId: colorChannelId || undefined }),
    [dataset.points, altitudeExaggeration, colorChannelId],
  )

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    const animate = (now: number) => {
      const delta = Math.min(0.1, (now - previous) / 1000)
      previous = now
      setPlaybackFraction((value) => (value + delta * playbackSpeed / Math.max(4, geometry.vertices.length / 20)) % 1)
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [playing, playbackSpeed, geometry.vertices.length])

  useEffect(() => {
    if (!autoRotate) return
    let frame = 0
    let previous = performance.now()
    const animate = (now: number) => {
      const delta = Math.min(0.1, (now - previous) / 1000)
      previous = now
      setCamera((current) => ({ ...current, yaw: current.yaw + delta * 0.22 }))
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [autoRotate])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(480, Math.floor(rect.width))
      const height = Math.max(420, Math.floor(rect.height))
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== width * pixelRatio || canvas.height !== height * pixelRatio) {
        canvas.width = width * pixelRatio
        canvas.height = height * pixelRatio
      }
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      context.clearRect(0, 0, width, height)
      const background = context.createLinearGradient(0, 0, 0, height)
      background.addColorStop(0, '#07101d')
      background.addColorStop(1, '#02050a')
      context.fillStyle = background
      context.fillRect(0, 0, width, height)

      const projected = projectVertices(geometry.vertices, camera, projection, width, height)
      projectedRef.current = projected
      if (projected.length === 0) return

      if (showGrid) drawGrid(context, camera, projection, geometry.vertices, width, height)
      if (showCurtain) drawCurtain(context, projected, height)

      context.lineJoin = 'round'
      context.lineCap = 'round'
      drawPath(context, projected, colorChannelId, geometry.colorRange, indexRange)

      if (indexRange) {
        const range = projected.filter((vertex) => vertex.sourceIndex >= indexRange.start && vertex.sourceIndex <= indexRange.end)
        if (range.length > 1) {
          context.beginPath()
          range.forEach((vertex, index) => index === 0 ? context.moveTo(vertex.x, vertex.y) : context.lineTo(vertex.x, vertex.y))
          context.strokeStyle = '#facc15'
          context.lineWidth = 5
          context.globalAlpha = 0.95
          context.stroke()
          context.globalAlpha = 1
        }
      }

      if (showPoints) {
        const stride = Math.max(1, Math.floor(projected.length / 2500))
        for (let index = 0; index < projected.length; index += stride) {
          const vertex = projected[index]!
          context.beginPath()
          context.arc(vertex.x, vertex.y, 2.2, 0, Math.PI * 2)
          context.fillStyle = vertexColor(vertex, geometry.colorRange, colorChannelId)
          context.fill()
        }
      }

      const playbackIndex = Math.min(projected.length - 1, Math.round(playbackFraction * (projected.length - 1)))
      const playback = projected[playbackIndex]
      if (playback) drawMarker(context, playback.x, playback.y, 8, '#ff4d2e', '#ffffff')

      const selected = pointIndex === null ? null : nearestProjected(projected, pointIndex)
      if (selected) drawMarker(context, selected.x, selected.y, 9, '#ffffff', '#ea4f2f')

      const first = projected[0]!
      const last = projected[projected.length - 1]!
      drawMarker(context, first.x, first.y, 6, '#22c55e', '#dcfce7')
      drawMarker(context, last.x, last.y, 6, '#ef4444', '#fee2e2')

      context.fillStyle = '#93a4bd'
      context.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace'
      context.fillText('EAST →', 18, height - 18)
      context.save()
      context.translate(18, 90)
      context.rotate(-Math.PI / 2)
      context.fillText('UP →', 0, 0)
      context.restore()
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [geometry, camera, projection, showGrid, showCurtain, showPoints, colorChannelId, indexRange, pointIndex, playbackFraction])

  useEffect(() => {
    if (!followPlayback || geometry.vertices.length === 0) return
    const index = Math.min(geometry.vertices.length - 1, Math.round(playbackFraction * (geometry.vertices.length - 1)))
    const vertex = geometry.vertices[index]
    if (!vertex) return
    const scale = Math.max(trajectorySpan(geometry.vertices), 1)
    setCamera((current) => ({ ...current, panX: -(vertex.eastM / scale) * 180, panY: (vertex.upM / scale) * 120 }))
  }, [followPlayback, playbackFraction, geometry.vertices])

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, mode: event.button === 2 || event.shiftKey ? 'pan' : 'orbit', moved: false }
  }
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true
    drag.x = event.clientX
    drag.y = event.clientY
    setCamera((current) => drag.mode === 'orbit'
      ? { ...current, yaw: current.yaw + dx * 0.008, pitch: clamp(current.pitch + dy * 0.008, -1.45, 1.45) }
      : { ...current, panX: current.panX + dx, panY: current.panY + dy })
  }
  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.moved) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const nearest = projectedRef.current.reduce<{ sourceIndex: number; distance: number } | null>((best, vertex) => {
      const distance = Math.hypot(vertex.x - x, vertex.y - y)
      return !best || distance < best.distance ? { sourceIndex: vertex.sourceIndex, distance } : best
    }, null)
    if (nearest && nearest.distance < 18) selectPoint(nearest.sourceIndex)
  }

  return (
    <div className="analysis-panel trajectory-panel">
      <div className="analysis-toolbar trajectory-toolbar">
        <label className="num-field"><span>altitude exaggeration</span><input type="number" min={0.1} max={100} step={0.5} value={altitudeExaggeration} onChange={(event) => setAltitudeExaggeration(Math.max(0.1, Math.min(100, Number(event.target.value) || 1)))} /></label>
        <label className="num-field"><span>color channel</span><select value={colorChannelId} onChange={(event) => setColorChannelId(event.target.value)}><option value="">single color</option><option value="elevation">elevation</option>{dataset.channels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}</select></label>
        <label className="num-field"><span>projection</span><select value={projection} onChange={(event) => setProjection(event.target.value as ProjectionMode)}><option value="perspective">perspective</option><option value="orthographic">orthographic</option></select></label>
        <label className="chk"><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />ground grid</label>
        <label className="chk"><input type="checkbox" checked={showCurtain} onChange={(event) => setShowCurtain(event.target.checked)} />vertical curtain</label>
        <label className="chk"><input type="checkbox" checked={showPoints} onChange={(event) => setShowPoints(event.target.checked)} />points</label>
        <label className="chk"><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} />auto rotate</label>
        <button type="button" onClick={() => setCamera(DEFAULT_CAMERA)}>Reset camera</button>
        <button type="button" onClick={() => setCamera((current) => ({ ...current, zoom: 1, panX: 0, panY: 0 }))}>Fit trajectory</button>
        {pointIndex !== null && <button type="button" className="chip chip-on" onClick={clearSelection}>selected #{pointIndex} ×</button>}
        {indexRange && <button type="button" className="chip chip-range" onClick={clearRange}>range {indexRange.start}–{indexRange.end} ×</button>}
      </div>

      <canvas
        ref={canvasRef}
        className="trajectory-three-canvas"
        aria-label="Interactive local ENU trajectory scene"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => { dragRef.current = null }}
        onWheel={(event) => { event.preventDefault(); setCamera((current) => ({ ...current, zoom: clamp(current.zoom * Math.exp(-event.deltaY * 0.001), 0.15, 12) })) }}
      />

      <div className="trajectory-playback">
        <button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause' : 'Play'}</button>
        <button type="button" onClick={() => { setPlaying(false); setPlaybackFraction(0) }}>Restart</button>
        <input aria-label="Playback position" type="range" min={0} max={1} step={0.001} value={playbackFraction} onChange={(event) => { setPlaying(false); setPlaybackFraction(Number(event.target.value)) }} />
        <label>speed<select value={playbackSpeed} onChange={(event) => setPlaybackSpeed(Number(event.target.value))}><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
        <label className="chk"><input type="checkbox" checked={followPlayback} onChange={(event) => setFollowPlayback(event.target.checked)} />follow marker</label>
        <span className="mono small">{Math.round(playbackFraction * 100)}%</span>
      </div>

      <div className="metric-grid">
        <Metric label="source points" value={geometry.sourcePointCount.toLocaleString()} />
        <Metric label="valid coordinates" value={geometry.validPointCount.toLocaleString()} />
        <Metric label="rendered vertices" value={geometry.renderedPointCount.toLocaleString()} />
        <Metric label="east span" value={`${format(geometry.bounds.maxEastM - geometry.bounds.minEastM)} m`} />
        <Metric label="north span" value={`${format(geometry.bounds.maxNorthM - geometry.bounds.minNorthM)} m`} />
        <Metric label="up span" value={`${format(geometry.bounds.maxUpM - geometry.bounds.minUpM)} m`} />
      </div>
      <div className="muted small">Drag to orbit, Shift/right-drag to pan, and use the wheel to zoom. Click near the trajectory to synchronize selection. Brushed chart ranges are emphasized in yellow.</div>
    </div>
  )
}

function projectVertices(vertices: readonly Trajectory3dVertex[], camera: CameraState, projection: ProjectionMode, width: number, height: number): ScreenVertex[] {
  if (vertices.length === 0) return []
  const center = trajectoryCenter(vertices)
  const span = Math.max(trajectorySpan(vertices), 1)
  const cosYaw = Math.cos(camera.yaw), sinYaw = Math.sin(camera.yaw)
  const cosPitch = Math.cos(camera.pitch), sinPitch = Math.sin(camera.pitch)
  const baseScale = Math.min(width, height) * 0.72 / span * camera.zoom
  return vertices.map((vertex) => {
    const east = vertex.eastM - center.eastM
    const north = vertex.northM - center.northM
    const up = vertex.upM - center.upM
    const x1 = east * cosYaw - north * sinYaw
    const z1 = east * sinYaw + north * cosYaw
    const y2 = up * cosPitch - z1 * sinPitch
    const depth = up * sinPitch + z1 * cosPitch
    const perspective = projection === 'perspective' ? clamp(1 / (1 + depth / (span * 2.4)), 0.35, 2.4) : 1
    return { ...vertex, x: width / 2 + camera.panX + x1 * baseScale * perspective, y: height / 2 + camera.panY - y2 * baseScale * perspective, depth }
  })
}

function drawPath(context: CanvasRenderingContext2D, projected: readonly ScreenVertex[], colorChannelId: string, range: { min: number; max: number } | undefined, indexRange: { start: number; end: number } | null) {
  if (projected.length < 2) return
  for (let index = 1; index < projected.length; index++) {
    const previous = projected[index - 1]!, current = projected[index]!
    const inRange = indexRange !== null && current.sourceIndex >= indexRange.start && current.sourceIndex <= indexRange.end
    context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(current.x, current.y)
    context.strokeStyle = inRange ? '#facc15' : vertexColor(current, range, colorChannelId)
    context.lineWidth = inRange ? 4.5 : 2.2
    context.globalAlpha = inRange ? 1 : 0.88
    context.stroke()
  }
  context.globalAlpha = 1
}

function drawGrid(context: CanvasRenderingContext2D, camera: CameraState, projection: ProjectionMode, vertices: readonly Trajectory3dVertex[], width: number, height: number) {
  const center = trajectoryCenter(vertices)
  const span = Math.max(trajectorySpan(vertices), 1)
  const lines = 10
  const project = (eastM: number, northM: number, upM: number) => projectCoordinate(eastM, northM, upM, center, span, camera, projection, width, height)
  context.strokeStyle = 'rgba(71, 85, 105, 0.34)'
  context.lineWidth = 1
  for (let step = -lines; step <= lines; step++) {
    const offset = span * step / lines
    const a = project(center.eastM - span, center.northM + offset, 0)
    const b = project(center.eastM + span, center.northM + offset, 0)
    const c = project(center.eastM + offset, center.northM - span, 0)
    const d = project(center.eastM + offset, center.northM + span, 0)
    context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke()
    context.beginPath(); context.moveTo(c.x, c.y); context.lineTo(d.x, d.y); context.stroke()
  }
}

function projectCoordinate(eastM: number, northM: number, upM: number, center: { eastM: number; northM: number; upM: number }, span: number, camera: CameraState, projection: ProjectionMode, width: number, height: number) {
  const east = eastM - center.eastM
  const north = northM - center.northM
  const up = upM - center.upM
  const cosYaw = Math.cos(camera.yaw), sinYaw = Math.sin(camera.yaw)
  const cosPitch = Math.cos(camera.pitch), sinPitch = Math.sin(camera.pitch)
  const x1 = east * cosYaw - north * sinYaw
  const z1 = east * sinYaw + north * cosYaw
  const y2 = up * cosPitch - z1 * sinPitch
  const depth = up * sinPitch + z1 * cosPitch
  const baseScale = Math.min(width, height) * 0.72 / span * camera.zoom
  const perspective = projection === 'perspective' ? clamp(1 / (1 + depth / (span * 2.4)), 0.35, 2.4) : 1
  return { x: width / 2 + camera.panX + x1 * baseScale * perspective, y: height / 2 + camera.panY - y2 * baseScale * perspective }
}

function drawCurtain(context: CanvasRenderingContext2D, projected: readonly ScreenVertex[], height: number) {
  const stride = Math.max(1, Math.floor(projected.length / 500))
  context.strokeStyle = 'rgba(37, 99, 235, 0.22)'
  context.lineWidth = 1
  for (let index = 0; index < projected.length; index += stride) {
    const vertex = projected[index]!
    context.beginPath(); context.moveTo(vertex.x, vertex.y); context.lineTo(vertex.x, Math.min(height - 20, vertex.y + 120)); context.stroke()
  }
}

function drawMarker(context: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string, stroke: string) {
  context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2)
  context.fillStyle = fill; context.fill()
  context.strokeStyle = stroke; context.lineWidth = 2; context.stroke()
}

function vertexColor(vertex: Trajectory3dVertex, range: { min: number; max: number } | undefined, channel: string): string {
  if (!channel || !range || vertex.colorValue === undefined) return '#38bdf8'
  const ratio = range.max === range.min ? 0.5 : clamp((vertex.colorValue - range.min) / (range.max - range.min), 0, 1)
  return `hsl(${220 - ratio * 210} 78% 58%)`
}
function trajectoryCenter(vertices: readonly Trajectory3dVertex[]) { const b = bounds(vertices); return { eastM: (b.minE + b.maxE) / 2, northM: (b.minN + b.maxN) / 2, upM: (b.minU + b.maxU) / 2 } }
function trajectorySpan(vertices: readonly Trajectory3dVertex[]) { const b = bounds(vertices); return Math.max(b.maxE - b.minE, b.maxN - b.minN, b.maxU - b.minU) }
function bounds(vertices: readonly Trajectory3dVertex[]) { let minE=Infinity,maxE=-Infinity,minN=Infinity,maxN=-Infinity,minU=Infinity,maxU=-Infinity; for(const v of vertices){minE=Math.min(minE,v.eastM);maxE=Math.max(maxE,v.eastM);minN=Math.min(minN,v.northM);maxN=Math.max(maxN,v.northM);minU=Math.min(minU,v.upM);maxU=Math.max(maxU,v.upM)} return {minE,maxE,minN,maxN,minU,maxU} }
function nearestProjected(vertices: readonly ScreenVertex[], sourceIndex: number): ScreenVertex | null { let best: ScreenVertex | null = null; for (const vertex of vertices) if (!best || Math.abs(vertex.sourceIndex-sourceIndex)<Math.abs(best.sourceIndex-sourceIndex)) best=vertex; return best }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric-card"><span className="metric-label">{label}</span><strong className="mono">{value}</strong></div> }
function format(value: number): string { return Math.abs(value) >= 1000 ? value.toFixed(0) : value.toFixed(1) }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)) }
