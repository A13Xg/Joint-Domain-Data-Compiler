// Map furniture that has to move with the map: the scale bar, the offline
// lat/lon grid, and the measure tool's line. The geometry behind each lives in
// visualization/map/mapAids.ts; these only translate it to Leaflet.
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import L, { type LatLngTuple } from 'leaflet'
import { CircleMarker, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { UnitSystem } from '../core/units'
import { graticuleLines, graticuleStep, niceScale } from '../visualization/map/mapAids'

function useViewTick(): number {
  const [tick, setTick] = useState(0)
  useMapEvents({ moveend: () => setTick((value) => value + 1), zoomend: () => setTick((value) => value + 1), resize: () => setTick((value) => value + 1) })
  return tick
}

/**
 * A scale bar in the app's display units (metres/km, or feet/NM). Leaflet's
 * own scale control only knows metric and imperial statute miles, which is
 * neither of the units this app displays in the nautical setting.
 */
export function MapScaleBar({ unitSystem }: { unitSystem: UnitSystem }) {
  const map = useMap()
  useViewTick()
  const size = map.getSize()
  const y = size.y / 2
  // Ground resolution at the vertical centre of the view: on a Mercator map it
  // varies with latitude, so a bar measured at the top edge would be wrong at the bottom.
  const metersPerPixel = map.distance(map.containerPointToLatLng([size.x / 2 - 50, y]), map.containerPointToLatLng([size.x / 2 + 50, y])) / 100
  const scale = niceScale(metersPerPixel, 140, unitSystem)
  if (!scale) return null
  return createPortal(
    <div className="map-scale-bar" aria-label={`Scale: ${scale.label}`} role="img">
      <div className="map-scale-bar-line" style={{ width: `${scale.widthPx}px` }} />
      <span>{scale.label}</span>
    </div>,
    map.getContainer(),
  )
}

/**
 * Meridians and parallels for the "offline grid" basemap, which used to be a
 * blank grey plane: with no tiles there was no reference at all for where, or
 * how big, anything was. Lines adapt to the zoom; labels are wrapped into ±180.
 */
export function OfflineGraticule() {
  const map = useMap()
  const tick = useViewTick()
  const grid = useMemo(() => {
    const bounds = map.getBounds()
    const view = { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() }
    const step = graticuleStep(Math.max(view.north - view.south, view.east - view.west))
    return { view, ...graticuleLines(view, step) }
    // `tick` is the dependency that matters: the map object is stable, its view is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tick])
  const { view } = grid
  const south = Math.max(-85, view.south), north = Math.min(85, view.north)
  const labelLat = south + (north - south) * 0.045
  // Latitude labels on the right edge: the left carries the zoom control and the scale bar.
  const labelLon = view.east - (view.east - view.west) * 0.004
  return (
    <>
      {grid.meridians.map((line) => <Polyline key={`m${line.value}`} positions={[[south, line.value], [north, line.value]] as LatLngTuple[]} pathOptions={{ color: '#64748b', weight: 1, opacity: 0.55, interactive: false }} />)}
      {grid.parallels.map((line) => <Polyline key={`p${line.value}`} positions={[[line.value, view.west], [line.value, view.east]] as LatLngTuple[]} pathOptions={{ color: '#64748b', weight: 1, opacity: 0.55, interactive: false }} />)}
      {/* Skip longitude labels in the lower-left corner, under the scale bar. */}
      {grid.meridians.filter((line) => map.latLngToContainerPoint([labelLat, line.value]).x > 120).map((line) => <Marker key={`ml${line.value}`} position={[labelLat, line.value]} interactive={false} icon={L.divIcon({ className: 'graticule-label graticule-label-meridian', html: `<span>${line.label}</span>`, iconSize: [0, 0] })} />)}
      {grid.parallels.map((line) => <Marker key={`pl${line.value}`} position={[line.value, labelLon]} interactive={false} icon={L.divIcon({ className: 'graticule-label graticule-label-parallel', html: `<span>${line.label}</span>`, iconSize: [0, 0] })} />)}
    </>
  )
}

/** The measure tool's clicks and drawing. Clicks on the map add a vertex while active. */
export function MeasureLayer({ vertices, onAdd }: { vertices: ReadonlyArray<{ lat: number; lon: number }>; onAdd: (vertex: { lat: number; lon: number }) => void }) {
  useMapEvents({ click: (event) => onAdd({ lat: event.latlng.lat, lon: event.latlng.lng }) })
  const positions = vertices.map((vertex): LatLngTuple => [vertex.lat, vertex.lon])
  return (
    <>
      {positions.length > 1 && <Polyline positions={positions} pathOptions={{ color: '#f8fafc', weight: 3, opacity: 0.95, dashArray: '8 6', interactive: false }} />}
      {positions.map((position, index) => (
        <CircleMarker key={index} center={position} radius={5} interactive={false} pathOptions={{ color: '#0f172a', weight: 2, fillColor: '#f8fafc', fillOpacity: 1 }}>
          <Tooltip permanent direction="top" offset={[0, -6]} className="measure-vertex-label">{index === 0 ? 'A' : String.fromCharCode(65 + Math.min(index, 25))}</Tooltip>
        </CircleMarker>
      ))}
    </>
  )
}
