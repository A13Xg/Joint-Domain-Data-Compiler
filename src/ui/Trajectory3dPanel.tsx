import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Dataset } from '../core/model'
import { DEFAULT_QUALITY_EVENT_CONFIG, detectQualityEvents } from '../core/quality/events'
import { buildSharedTrajectory3dGeometry, playbackTimeRange, playbackVertexIndex, type Trajectory3dVertex } from '../visualization/scene3d/trajectory'
import { DEFAULT_SCENE_CAMERA, SIDE_SCENE_CAMERA, TOP_SCENE_CAMERA, axisScreenDirections, cameraForKey, orbitCamera, projectEnu, sceneFrame, type SceneCamera, type SceneFrame, type SceneProjection } from '../visualization/scene3d/camera'
import type { WorkspaceDisplay } from '../state/workspaceDisplay'
import { epochMsToIso } from '../core/format'
import { assessDatasetCompatibility } from '../core/metadataCompatibility'
import { usePointSelection } from '../state/pointSelection'
import { useAppSettings } from '../state/settings'
import { SelectionChip } from './SelectionChip'
import type { WorkspaceState } from '../state/workspace'

type Projection = SceneProjection
type Camera = SceneCamera
type ScreenVertex = Trajectory3dVertex & { x: number; y: number }
const DEFAULT_CAMERA = DEFAULT_SCENE_CAMERA

const COMPANION_FALLBACK_COLOR = '#a78bfa'

export function Trajectory3dPanel({ dataset, datasets, display, workspace, onWorkspaceChange }: { dataset: Dataset; datasets: Dataset[]; display?: WorkspaceDisplay; workspace: WorkspaceState['scene3d']; onWorkspaceChange: (next: WorkspaceState['scene3d']) => void }) {
  const { altitudeExaggeration, projection, gapThresholdSeconds } = workspace
  const [colorChannelId, setColorChannelId] = useState('')

  const [showGrid, setShowGrid] = useState(true)
  const [showCurtain, setShowCurtain] = useState(false)
  const [showPoints, setShowPoints] = useState(true)

  const [playing, setPlaying] = useState(false)
  const [playback, setPlayback] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const projectedRef = useRef<ScreenVertex[]>([])
  const dragRef = useRef<{ x: number; y: number; pan: boolean; moved: boolean } | null>(null)
  const { pointIndex, hoverIndex, indexRange, selectPoint, setHoverIndex, clearPointSelection, clearRangeSelection, clearHover } = usePointSelection(dataset.points)
  const { scenePointBudget } = useAppSettings()
  const shared3d = useMemo(() => {
    // Companions follow the Sources tab's visibility, like the map's other tracks.
    const compatible = datasets.filter((candidate) => candidate.id !== dataset.id && display?.[candidate.id]?.visible !== false && assessDatasetCompatibility(dataset, candidate).level === 'compatible')
    return buildSharedTrajectory3dGeometry([dataset, ...compatible].map((candidate) => ({ id: candidate.id, points: candidate.points })), { altitudeExaggeration, maxPoints: scenePointBudget, colorChannelId: colorChannelId || undefined })
  }, [dataset, datasets, display, altitudeExaggeration, colorChannelId, scenePointBudget])
  const geometry = shared3d.tracks[0]!.geometry
  // Each companion in its own Sources-tab colour: a P5 sortie puts every
  // instrumented aircraft in this scene, and one shared purple made them
  // impossible to tell apart.
  const companions = useMemo(() => shared3d.tracks.slice(1).map((track) => ({
    id: track.id,
    name: datasets.find((candidate) => candidate.id === track.id)?.name ?? track.id,
    color: display?.[track.id]?.color ?? COMPANION_FALLBACK_COLOR,
    geometry: track.geometry,
  })), [shared3d, datasets, display])
  const frame = useMemo(() => sceneFrame(shared3d.tracks.map((track) => track.geometry.vertices)), [shared3d])
  const incompatibleCount = datasets.filter((candidate) => candidate.id !== dataset.id && assessDatasetCompatibility(dataset, candidate).level === 'blocked').length
  const qualityEvents = useMemo(() => detectQualityEvents(dataset.points, { ...DEFAULT_QUALITY_EVENT_CONFIG, gapMs: Math.max(1, gapThresholdSeconds * 1_000) }), [dataset.points, gapThresholdSeconds])
  const pathBreakIndices = useMemo(() => new Set(qualityEvents.filter((event) => event.kind === 'gap' || event.kind === 'coordinate-jump').map((event) => event.endIndex)), [qualityEvents])
  const jumpIndices = useMemo(() => new Set(qualityEvents.filter((event) => event.kind === 'coordinate-jump').map((event) => event.endIndex)), [qualityEvents])

  useEffect(() => {
    if (!playing) return
    let frame = 0, previous = performance.now()
    const animate = (now: number) => { const delta = Math.min(0.1, (now - previous) / 1000); previous = now; setPlayback((value) => (value + delta * speed / Math.max(4, geometry.vertices.length / 20)) % 1); frame = requestAnimationFrame(animate) }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, geometry.vertices.length])

  useEffect(() => {
    if (!playing || geometry.vertices.length === 0) return
    setHoverIndex(geometry.vertices[playbackVertexIndex(geometry.vertices, playback)]?.sourceIndex ?? null)
  }, [playing, playback, geometry.vertices, setHoverIndex])

  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const draw = () => {
      const rect = canvas.getBoundingClientRect(), width = Math.max(480, rect.width), height = Math.max(420, rect.height), ratio = Math.min(devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const background = context.createLinearGradient(0, 0, 0, height); background.addColorStop(0, '#07101d'); background.addColorStop(1, '#02050a'); context.fillStyle = background; context.fillRect(0, 0, width, height)
      if (!frame) { projectedRef.current = []; return }
      const projected = project(geometry.vertices, frame, camera, projection, width, height); projectedRef.current = projected
      if (!projected.length) return
      if (showGrid) grid(context, frame, camera, projection, width, height)
      for (const companion of companions) path(context, project(companion.geometry.vertices, frame, camera, projection, width, height), '', undefined, null, new Set(), new Set(), companion.color)
      if (showCurtain) curtain(context, geometry.vertices, projected, frame, camera, projection, width, height)
      path(context, projected, colorChannelId, geometry.colorRange, indexRange, pathBreakIndices, jumpIndices)
      if (showPoints) for (let index = 0, stride = Math.max(1, Math.floor(projected.length / 2500)); index < projected.length; index += stride) dot(context, projected[index]!, 2.2, vertexColor(projected[index]!, geometry.colorRange, colorChannelId), vertexColor(projected[index]!, geometry.colorRange, colorChannelId))
      const playbackPoint = projected[playbackVertexIndex(geometry.vertices, playback)]; if (playbackPoint) dot(context, playbackPoint, 8, '#ff4d2e', '#fff')
      const hovered = hoverIndex === null ? null : nearestSource(projected, hoverIndex); if (hovered) dot(context, hovered, 7, '#38bdf8', '#fff')
      const selected = pointIndex === null ? null : nearestSource(projected, pointIndex); if (selected) dot(context, selected, 9, '#fff', '#ea4f2f')
      dot(context, projected[0]!, 6, '#22c55e', '#dcfce7'); dot(context, projected[projected.length - 1]!, 6, '#ef4444', '#fee2e2')
      gizmo(context, camera, height)
    }
    draw(); const observer = new ResizeObserver(draw); observer.observe(canvas); return () => observer.disconnect()
  }, [geometry, companions, frame, camera, projection, showGrid, showCurtain, showPoints, colorChannelId, indexRange, pointIndex, hoverIndex, playback, pathBreakIndices, jumpIndices])

  const nearestPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => { const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top; return projectedRef.current.reduce<{ sourceIndex: number; distance: number } | null>((best, vertex) => { const distance = Math.hypot(vertex.x - x, vertex.y - y); return !best || distance < best.distance ? { sourceIndex: vertex.sourceIndex, distance } : best }, null) }
  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => { const drag = dragRef.current; if (!drag) { const nearest = nearestPointer(event); setHoverIndex(nearest && nearest.distance < 18 ? nearest.sourceIndex : null); return } const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true; drag.x = event.clientX; drag.y = event.clientY; setCamera((current) => drag.pan ? { ...current, panX: current.panX + dx, panY: current.panY + dy } : orbitCamera(current, dx, dy)) }
  // Pans the camera so the named sample lands in the middle of the canvas.
  // The renderer already keeps every vertex's screen position, and pan is in
  // the same CSS-pixel space the pointer drag uses, so centring is a delta —
  // no re-projection and no camera reset, which would throw away the orbit the
  // user set up to look at this point in the first place.
  const centreOnSelection = (target: number) => {
    const canvas = canvasRef.current
    const vertex = nearestSource(projectedRef.current, target)
    if (!canvas || !vertex) return
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(480, rect.width)
    const height = Math.max(420, rect.height)
    setCamera((current) => ({ ...current, panX: current.panX + width / 2 - vertex.x, panY: current.panY + height / 2 - vertex.y }))
  }

  const scrub = (value: number) => { setPlaying(false); setPlayback(value); setHoverIndex(geometry.vertices[playbackVertexIndex(geometry.vertices, value)]?.sourceIndex ?? null) }
  const playbackRange = useMemo(() => playbackTimeRange(geometry.vertices), [geometry.vertices])
  const playbackVertex = geometry.vertices[playbackVertexIndex(geometry.vertices, playback)]
  const playbackReadout = playbackRange && playbackVertex?.time !== undefined
    ? `${epochMsToIso(playbackVertex.time)} · T+${formatElapsed(playbackVertex.time - playbackRange.startMs)}`
    : `${Math.round(playback * 100)}% (untimed — by sample order)`
  const onCanvasKey = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === 'Home' || event.key === '0') { event.preventDefault(); setCamera(DEFAULT_CAMERA); return }
    const next = cameraForKey(camera, event.key, event.shiftKey)
    if (!next) return
    event.preventDefault()
    setCamera(next)
  }

  return <div className="analysis-panel trajectory-panel">
    <div className="analysis-toolbar trajectory-toolbar">
      <label className="num-field"><span>altitude exaggeration</span><input type="number" min={0.1} max={100} step={0.5} value={altitudeExaggeration} onChange={(event) => onWorkspaceChange({ ...workspace, altitudeExaggeration: clamp(Number(event.target.value) || 1, 0.1, 100) })} /></label>
      <label className="num-field"><span>color channel</span><select value={colorChannelId} onChange={(event) => setColorChannelId(event.target.value)}><option value="">single color</option><option value="elevation">elevation</option>{dataset.channels.map((channel) => <option key={channel} value={channel}>{channel}</option>)}</select></label>
      <label className="num-field"><span>projection</span><select value={projection} onChange={(event) => onWorkspaceChange({ ...workspace, projection: event.target.value as Projection })}><option value="perspective">perspective</option><option value="orthographic">orthographic</option></select></label>
      <label className="num-field"><span>gap split (s)</span><input type="number" min={0} step={1} value={gapThresholdSeconds} onChange={(event) => onWorkspaceChange({ ...workspace, gapThresholdSeconds: Math.max(0, Number(event.target.value) || 0) })} /></label>
      <label className="chk"><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />ground grid</label><label className="chk"><input type="checkbox" checked={showCurtain} onChange={(event) => setShowCurtain(event.target.checked)} />vertical curtain</label><label className="chk"><input type="checkbox" checked={showPoints} onChange={(event) => setShowPoints(event.target.checked)} />points</label>
      <button type="button" onClick={() => setCamera(DEFAULT_CAMERA)}>Reset camera</button><button type="button" onClick={() => setCamera(TOP_SCENE_CAMERA)} title="Look straight down, north up">Top</button><button type="button" onClick={() => setCamera(SIDE_SCENE_CAMERA)} title="Look along the horizon towards north">Side</button><button type="button" onClick={() => setCamera((current) => ({ ...current, zoom: 1, panX: 0, panY: 0 }))}>Fit trajectory</button>
      {pointIndex !== null && <SelectionChip label={`selected #${pointIndex}`} onJump={() => centreOnSelection(pointIndex)} jumpTitle="Centre the scene on this point" onClear={clearPointSelection} clearLabel="Clear point selection" />}{indexRange && <SelectionChip label={`range ${indexRange.start}–${indexRange.end}`} tone="range" onJump={() => centreOnSelection(Math.round((indexRange.start + indexRange.end) / 2))} jumpTitle="Centre the scene on this range" onClear={clearRangeSelection} clearLabel="Clear range selection" />}
    </div>
    <canvas ref={canvasRef} className="trajectory-three-canvas" tabIndex={0} onKeyDown={onCanvasKey} aria-label="Interactive local ENU trajectory scene. Arrow keys orbit, Shift+arrows pan, plus and minus zoom, Home resets the camera." onContextMenu={(event) => event.preventDefault()} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { x: event.clientX, y: event.clientY, pan: event.button === 2 || event.shiftKey, moved: false } }} onPointerMove={pointerMove} onPointerUp={(event) => { const drag = dragRef.current; dragRef.current = null; if (!drag?.moved) { const nearest = nearestPointer(event); if (nearest && nearest.distance < 18) selectPoint(nearest.sourceIndex) } }} onPointerLeave={() => { dragRef.current = null; clearHover() }} onWheel={(event) => { event.preventDefault(); setCamera((current) => ({ ...current, zoom: clamp(current.zoom * Math.exp(-event.deltaY * 0.001), 0.15, 12) })) }} />
    <div className="trajectory-playback"><button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? 'Pause' : 'Play'}</button><button type="button" onClick={() => scrub(0)}>Restart</button><input aria-label="Playback position" type="range" min={0} max={1} step={0.001} value={playback} onChange={(event) => scrub(Number(event.target.value))} /><label>speed<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label><span className="mono small" title={playbackRange ? 'Playback advances in proportion to recorded time' : 'No usable timestamps: playback advances by sample order'}>{playbackReadout}</span></div>
    {(dataset.metadata?.altitudeReference === 'UNKNOWN' || dataset.metadata?.timeReference === 'UNKNOWN') && <div className="warn-line">Reference metadata is incomplete: 3D geometry is local visualization only and must not be used for cross-source altitude/time comparison.</div>}
    {companions.length > 0 && <div className="analysis-summary scene-companions">Shared ENU frame with {companions.length} compatible companion track{companions.length === 1 ? '' : 's'}:{companions.map((companion) => <span key={companion.id} className="scene-companion"><span className="chip-dot" style={{ background: companion.color }} />{companion.name}</span>)}<span className="muted small">Colours and visibility follow the Sources tab.</span></div>}
    {incompatibleCount > 0 && <div className="warn-line">{incompatibleCount} dataset{incompatibleCount === 1 ? ' is' : 's are'} excluded from shared 3D because their metadata references are incompatible.</div>}
    <div className="metric-grid"><Metric label="source points" value={geometry.sourcePointCount.toLocaleString()} /><Metric label="valid coordinates" value={geometry.validPointCount.toLocaleString()} /><Metric label="rendered vertices" value={geometry.renderedPointCount.toLocaleString()} /><Metric label="east span" value={`${format(geometry.bounds.maxEastM - geometry.bounds.minEastM)} m`} /><Metric label="north span" value={`${format(geometry.bounds.maxNorthM - geometry.bounds.minNorthM)} m`} /><Metric label="up span" value={`${format(geometry.bounds.maxUpM - geometry.bounds.minUpM)} m`} /></div>
    <div className="muted small">Drag to orbit (dragging down raises the camera), Shift/right-drag to pan, and use the wheel to zoom — or focus the scene and use the arrow keys, Shift+arrows, +/− and Home. The axes in the corner show east (E), north (N) and up (U). Playback moves in proportion to recorded time. Hover or playback updates the synchronized data cursor; click selects a persistent point.</div>
  </div>
}

function project(vertices: readonly Trajectory3dVertex[], frame: SceneFrame, camera: Camera, projection: Projection, width: number, height: number): ScreenVertex[] { return vertices.map((vertex) => { const screen = projectEnu(vertex.eastM, vertex.northM, vertex.upM, frame, camera, projection, width, height); return { ...vertex, x: screen.x, y: screen.y } }) }
function path(context: CanvasRenderingContext2D, vertices: ScreenVertex[], channel: string, range: { min: number; max: number } | undefined, selected: { start: number; end: number } | null, breakIndices: ReadonlySet<number>, jumpIndices: ReadonlySet<number>, fixedColor?: string) { for (let index = 1; index < vertices.length; index++) { const a = vertices[index - 1]!, b = vertices[index]!; if (breakIndices.has(b.sourceIndex)) { qualityMarker(context, b, jumpIndices.has(b.sourceIndex)); continue } const inRange = selected !== null && b.sourceIndex >= selected.start && b.sourceIndex <= selected.end; context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.strokeStyle = fixedColor ?? (inRange ? '#facc15' : vertexColor(b, range, channel)); context.lineWidth = inRange ? 4.5 : 2.2; context.stroke() } }
function qualityMarker(context: CanvasRenderingContext2D, vertex: ScreenVertex, jump: boolean) { const color = jump ? '#ef4444' : '#f59e0b'; context.strokeStyle = color; context.fillStyle = color; context.lineWidth = 2; context.beginPath(); context.arc(vertex.x, vertex.y, 5, 0, Math.PI * 2); context.stroke(); context.font = '11px system-ui'; context.fillText(jump ? 'jump' : 'gap', vertex.x + 7, vertex.y - 7) }
// Drawn at the scene's floor (its lowest sample), not at the origin's height: the
// origin is the first valid sample, which for a recording that starts airborne
// would put the grid through the middle of the trajectory.
function grid(context: CanvasRenderingContext2D, frame: SceneFrame, camera: Camera, projection: Projection, width: number, height: number) { const span = frame.spanM, samples: Trajectory3dVertex[] = []; for (let step = -10; step <= 10; step++) { const offset = span * step / 10; samples.push({ eastM: frame.centerEastM - span, northM: frame.centerNorthM + offset, upM: frame.floorUpM, sourceIndex: 0 }, { eastM: frame.centerEastM + span, northM: frame.centerNorthM + offset, upM: frame.floorUpM, sourceIndex: 0 }, { eastM: frame.centerEastM + offset, northM: frame.centerNorthM - span, upM: frame.floorUpM, sourceIndex: 0 }, { eastM: frame.centerEastM + offset, northM: frame.centerNorthM + span, upM: frame.floorUpM, sourceIndex: 0 }) } const projected = project(samples, frame, camera, projection, width, height); context.strokeStyle = 'rgba(71,85,105,.34)'; context.lineWidth = 1; for (let index = 0; index < projected.length; index += 4) { context.beginPath(); context.moveTo(projected[index]!.x, projected[index]!.y); context.lineTo(projected[index + 1]!.x, projected[index + 1]!.y); context.stroke(); context.beginPath(); context.moveTo(projected[index + 2]!.x, projected[index + 2]!.y); context.lineTo(projected[index + 3]!.x, projected[index + 3]!.y); context.stroke() } }
// Each drop runs to the sample's own foot on the floor, projected through the same
// camera. A fixed-length screen line (what this used to draw) showed every sample
// the same height above the ground whatever its altitude and whatever the view.
function curtain(context: CanvasRenderingContext2D, vertices: readonly Trajectory3dVertex[], projected: ScreenVertex[], frame: SceneFrame, camera: Camera, projection: Projection, width: number, height: number) { context.strokeStyle = 'rgba(37,99,235,.22)'; for (let index = 0, stride = Math.max(1, Math.floor(vertices.length / 500)); index < vertices.length; index += stride) { const vertex = vertices[index]!, top = projected[index]!, foot = projectEnu(vertex.eastM, vertex.northM, frame.floorUpM, frame, camera, projection, width, height); context.beginPath(); context.moveTo(top.x, top.y); context.lineTo(foot.x, foot.y); context.stroke() } }
function dot(context: CanvasRenderingContext2D, vertex: ScreenVertex, radius: number, fill: string, stroke: string) { context.beginPath(); context.arc(vertex.x, vertex.y, radius, 0, Math.PI * 2); context.fillStyle = fill; context.fill(); context.strokeStyle = stroke; context.lineWidth = 2; context.stroke() }
function vertexColor(vertex: Trajectory3dVertex, range: { min: number; max: number } | undefined, channel: string) { if (!channel || !range || vertex.colorValue === undefined) return '#38bdf8'; const ratio = range.max === range.min ? 0.5 : clamp((vertex.colorValue - range.min) / (range.max - range.min), 0, 1); return `hsl(${220 - ratio * 210} 78% 58%)` }
function nearestSource(vertices: ScreenVertex[], sourceIndex: number) { return vertices.reduce<ScreenVertex | null>((best, vertex) => !best || Math.abs(vertex.sourceIndex-sourceIndex) < Math.abs(best.sourceIndex-sourceIndex) ? vertex : best, null) }
// Orientation axes in the lower-left corner, drawn through the same rotation as
// the scene: without them a view from above and a view from below look alike.
function gizmo(context: CanvasRenderingContext2D, camera: Camera, height: number) {
  const origin = { x: 44, y: height - 44 }, length = 28, axes = axisScreenDirections(camera)
  const entries: Array<[string, { x: number; y: number }, string]> = [['E', axes.east, '#f87171'], ['N', axes.north, '#4ade80'], ['U', axes.up, '#60a5fa']]
  context.save()
  context.fillStyle = 'rgba(2,6,23,.55)'; context.beginPath(); context.arc(origin.x, origin.y, 38, 0, Math.PI * 2); context.fill()
  context.font = '600 10px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle'
  for (const [label, direction, color] of entries) {
    const tip = { x: origin.x + direction.x * length, y: origin.y + direction.y * length }
    context.strokeStyle = color; context.fillStyle = color; context.lineWidth = 2
    context.beginPath(); context.moveTo(origin.x, origin.y); context.lineTo(tip.x, tip.y); context.stroke()
    // An axis pointing at (or away from) the viewer has no length; label it in place.
    const reach = Math.hypot(direction.x, direction.y)
    context.fillText(label, origin.x + (reach < 0.2 ? 0 : direction.x / reach) * (length + 8), origin.y + (reach < 0.2 ? 0 : direction.y / reach) * (length + 8))
  }
  context.restore()
}
function formatElapsed(ms: number) { const total = Math.max(0, Math.round(ms / 1000)), h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60; return `${h > 0 ? `${h}:` : ''}${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}` }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric-card"><span className="metric-label">{label}</span><strong className="mono">{value}</strong></div> }
function format(value: number) { return Math.abs(value) >= 1000 ? value.toFixed(0) : value.toFixed(1) }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }
