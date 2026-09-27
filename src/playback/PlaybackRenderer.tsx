// 2D overhead (top-down) view: track paths plus each visible track's
// interpolated position at the current playback time. Canvas-based (no
// WebGL, no basemap dependency) — same "2D canvas, not WebGL" posture the
// existing 3D scene renderer already takes for this codebase's perf targets.
import { useEffect, useMemo, useRef } from 'react'
import { geodeticToEnu, type GeodeticCoordinate } from '../core/geodesy'
import { interpolateTrackPositionAtTime } from '../core/analytics/pairwise'
import type { PlaybackTrack } from './PlaybackState'

interface Props {
  tracks: readonly PlaybackTrack[]
  nowMs: number
}

interface ProjectedPoint {
  x: number
  y: number
}

export function PlaybackRenderer({ tracks, nowMs }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const origin = useMemo<GeodeticCoordinate | null>(() => {
    let sumLat = 0
    let sumLon = 0
    let count = 0
    for (const track of tracks) {
      for (const point of track.points) {
        sumLat += point.lat
        sumLon += point.lon
        count++
      }
    }
    if (count === 0) return null
    return { latDeg: sumLat / count, lonDeg: sumLon / count, heightM: 0 }
  }, [tracks])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !origin) return

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const width = container.clientWidth
      const height = container.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#0b0f17'
      ctx.fillRect(0, 0, width, height)

      const visible = tracks.filter((track) => track.visible && track.points.length > 0)
      if (visible.length === 0) return

      // East/north (meters) -> canvas pixels, fit to the loaded extent with 10% padding.
      let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity
      const projected = new Map<string, ProjectedPoint[]>()
      for (const track of visible) {
        const points: ProjectedPoint[] = []
        for (const point of track.points) {
          const enu = geodeticToEnu({ latDeg: point.lat, lonDeg: point.lon, heightM: point.ele ?? 0 }, origin)
          points.push({ x: enu.eastM, y: enu.northM })
          if (enu.eastM < minE) minE = enu.eastM
          if (enu.eastM > maxE) maxE = enu.eastM
          if (enu.northM < minN) minN = enu.northM
          if (enu.northM > maxN) maxN = enu.northM
        }
        projected.set(track.id, points)
      }
      const spanE = Math.max(maxE - minE, 1)
      const spanN = Math.max(maxN - minN, 1)
      const padding = 0.1
      const scale = Math.min(width / (spanE * (1 + padding * 2)), height / (spanN * (1 + padding * 2)))
      const centerE = (minE + maxE) / 2
      const centerN = (minN + maxN) / 2
      const toCanvas = (p: ProjectedPoint) => ({
        x: width / 2 + (p.x - centerE) * scale,
        // Screen Y grows downward; north is up.
        y: height / 2 - (p.y - centerN) * scale,
      })

      for (const track of visible) {
        const points = projected.get(track.id) ?? []
        if (points.length === 0) continue
        ctx.strokeStyle = track.color
        ctx.globalAlpha = 0.55
        ctx.lineWidth = 1.5
        ctx.beginPath()
        points.forEach((p, index) => {
          const c = toCanvas(p)
          if (index === 0) ctx.moveTo(c.x, c.y)
          else ctx.lineTo(c.x, c.y)
        })
        ctx.stroke()
        ctx.globalAlpha = 1

        const current = interpolateTrackPositionAtTime(track.points, nowMs)
        if (!current) continue
        const enu = geodeticToEnu({ latDeg: current.lat, lonDeg: current.lon, heightM: current.ele ?? 0 }, origin)
        const c = toCanvas({ x: enu.eastM, y: enu.northM })
        ctx.fillStyle = track.color
        ctx.beginPath()
        ctx.arc(c.x, c.y, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#e6edf6'
        ctx.font = '11px system-ui, sans-serif'
        ctx.fillText(track.callsign || track.name, c.x + 8, c.y - 8)
      }
    }

    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(container)
    return () => observer.disconnect()
  }, [tracks, nowMs, origin])

  return (
    <div ref={containerRef} className="playback-renderer" role="img" aria-label="Top-down playback view of loaded tracks">
      <canvas ref={canvasRef} />
    </div>
  )
}
