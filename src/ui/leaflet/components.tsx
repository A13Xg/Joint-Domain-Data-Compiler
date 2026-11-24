// In-house React bindings for the Leaflet layers the map uses, replacing
// react-leaflet (see ./context.ts for why). Each component owns one Leaflet
// layer: created once, added to the map on mount, removed on unmount, and
// updated in place when a prop changes identity -- the same reference
// comparisons react-leaflet made, so rendering behaves as it did.
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import L from 'leaflet'
import type { DivIcon, Icon, LatLngExpression, Layer, LeafletEventHandlerFnMap, Map as LeafletMap, PathOptions, PointExpression, TooltipOptions } from 'leaflet'
import { LayerContext, MapContext, useLeafletEvents, useMap } from './context'

interface MapContainerProps {
  center?: LatLngExpression
  zoom: number
  className?: string
  scrollWheelZoom?: boolean
  children?: ReactNode
}

const removedMaps = new WeakSet<LeafletMap>()

/** The map. `center`, `zoom` and `scrollWheelZoom` are read once, at creation. */
export function MapContainer({ center, zoom, className, scrollWheelZoom = true, children }: MapContainerProps) {
  const [initial] = useState(() => ({ center, zoom, scrollWheelZoom }))
  const [map, setMap] = useState<LeafletMap | null>(null)
  const instance = useRef<LeafletMap | null>(null)
  // Created once per component, however often React calls the ref: React 19's
  // development StrictMode calls it again on the same element, and a second
  // L.map() there throws.
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (node === null || instance.current) return
    const created = L.map(node, { ...(initial.center === undefined ? {} : { center: initial.center }), zoom: initial.zoom, scrollWheelZoom: initial.scrollWheelZoom })
    instance.current = created
    setMap(created)
  }, [initial])
  // Removed in a passive effect, as react-leaflet did, not in a ref cleanup. A
  // ref cleanup runs earlier, in the commit itself, which left a window where
  // the children's observers and listeners still acted on a removed map
  // (MapView's ResizeObserver threw "_leaflet_pos" there). Here the removal
  // shares a flush with the children's own cleanups. Keyed on `map`, so
  // StrictMode's simulated unmount, which runs before the map is in state,
  // never removes it.
  //
  // Removal is idempotent. Under development StrictMode the simulated remount
  // can run a map's cleanup, build a replacement on the same element (via the
  // ref), and then run the first map's re-registered cleanup again; a second
  // remove() on a container that now belongs to another map throws "Map
  // container is being reused by another instance" and took the map UI down.
  useEffect(() => {
    if (!map) return
    return () => {
      if (removedMaps.has(map)) return
      removedMaps.add(map)
      map.remove()
      if (instance.current === map) instance.current = null
    }
  }, [map])
  return (
    <div ref={attach} className={className}>
      {map && <MapContext.Provider value={map}>{children}</MapContext.Provider>}
    </div>
  )
}

/**
 * Applies `value` to the layer when it changes after the first render, never on
 * mount: the layer was built with it. Applying it again on mount redrew every
 * one of up to 4,000 point markers three extra times, which made a 100,000-point
 * map ~2.5 s slower to appear than react-leaflet, which compared props the same
 * way.
 */
function useOnChange<T>(value: T, apply: (value: T) => void): void {
  const previous = useRef(value)
  useEffect(() => {
    if (Object.is(previous.current, value)) return
    previous.current = value
    apply(value)
  }, [value, apply])
}

/** Adds `layer` to the map for as long as the component is mounted. */
function useOnMap(layer: Layer): void {
  const map = useMap()
  useEffect(() => {
    layer.addTo(map)
    return () => { layer.remove() }
  }, [map, layer])
}

function WithLayer({ layer, children }: { layer: Layer; children?: ReactNode }) {
  return children === undefined ? null : <LayerContext.Provider value={layer}>{children}</LayerContext.Provider>
}

interface TileLayerProps {
  url: string
  attribution?: string
  eventHandlers?: LeafletEventHandlerFnMap
}

export function TileLayer({ url, attribution, eventHandlers }: TileLayerProps) {
  const map = useMap()
  const [layer] = useState(() => L.tileLayer(url))
  useOnMap(layer)
  useLeafletEvents(layer, eventHandlers)
  useOnChange(url, useCallback((next: string) => { layer.setUrl(next) }, [layer]))
  // Through the attribution control rather than the layer option, which
  // Leaflet reads only when a layer is added: switching basemaps must swap the
  // credit too (OpenStreetMap's is a licence requirement), and react-leaflet
  // left the first basemap's credit in place.
  useEffect(() => {
    if (!attribution || !map.attributionControl) return
    map.attributionControl.addAttribution(attribution)
    return () => { map.attributionControl?.removeAttribution(attribution) }
  }, [map, attribution])
  return null
}

interface PathProps {
  pathOptions?: PathOptions
  eventHandlers?: LeafletEventHandlerFnMap
  children?: ReactNode
}

interface PolylineProps extends PathProps {
  positions: LatLngExpression[] | LatLngExpression[][]
}

export function Polyline({ positions, pathOptions, eventHandlers, children }: PolylineProps) {
  const [layer] = useState(() => L.polyline(positions, pathOptions))
  useOnMap(layer)
  useLeafletEvents(layer, eventHandlers)
  useOnChange(positions, useCallback((next: typeof positions) => { layer.setLatLngs(next) }, [layer]))
  useOnChange(pathOptions, useCallback((next?: PathOptions) => { layer.setStyle(next ?? {}) }, [layer]))
  return <WithLayer layer={layer}>{children}</WithLayer>
}

interface PolygonProps extends PathProps {
  positions: LatLngExpression[] | LatLngExpression[][] | LatLngExpression[][][]
}

export function Polygon({ positions, pathOptions, eventHandlers, children }: PolygonProps) {
  const [layer] = useState(() => L.polygon(positions, pathOptions))
  useOnMap(layer)
  useLeafletEvents(layer, eventHandlers)
  useOnChange(positions, useCallback((next: typeof positions) => { layer.setLatLngs(next) }, [layer]))
  useOnChange(pathOptions, useCallback((next?: PathOptions) => { layer.setStyle(next ?? {}) }, [layer]))
  return <WithLayer layer={layer}>{children}</WithLayer>
}

interface CircleMarkerProps extends PathProps {
  center: LatLngExpression
  radius?: number
  /** Read once, at creation: Leaflet fixes interactivity when the layer is built. */
  interactive?: boolean
}

export function CircleMarker({ center, radius = 10, interactive, pathOptions, eventHandlers, children }: CircleMarkerProps) {
  const [layer] = useState(() => L.circleMarker(center, { ...pathOptions, radius, ...(interactive === undefined ? {} : { interactive }) }))
  useOnMap(layer)
  useLeafletEvents(layer, eventHandlers)
  useOnChange(center, useCallback((next: LatLngExpression) => { layer.setLatLng(next) }, [layer]))
  useOnChange(radius, useCallback((next: number) => { layer.setRadius(next) }, [layer]))
  useOnChange(pathOptions, useCallback((next?: PathOptions) => { layer.setStyle(next ?? {}) }, [layer]))
  return <WithLayer layer={layer}>{children}</WithLayer>
}

interface MarkerProps {
  position: LatLngExpression
  icon?: Icon | DivIcon
  /** Read once, at creation. */
  interactive?: boolean
  eventHandlers?: LeafletEventHandlerFnMap
  children?: ReactNode
}

export function Marker({ position, icon, interactive, eventHandlers, children }: MarkerProps) {
  const [layer] = useState(() => L.marker(position, { ...(icon ? { icon } : {}), ...(interactive === undefined ? {} : { interactive }) }))
  useOnMap(layer)
  useLeafletEvents(layer, eventHandlers)
  useOnChange(position, useCallback((next: LatLngExpression) => { layer.setLatLng(next) }, [layer]))
  useOnChange(icon, useCallback((next?: Icon | DivIcon) => { if (next) layer.setIcon(next) }, [layer]))
  return <WithLayer layer={layer}>{children}</WithLayer>
}

interface TooltipProps {
  children?: ReactNode
  permanent?: boolean
  direction?: TooltipOptions['direction']
  offset?: PointExpression
  className?: string
}

/**
 * Binds a tooltip to the enclosing layer. Its React children are rendered
 * through a portal into the element Leaflet shows -- but only while it is open,
 * as react-leaflet did: the map binds one to each of up to 4,000 point markers,
 * and rendering all of their contents up front made it markedly slower.
 */
export function Tooltip({ children, permanent, direction, offset, className }: TooltipProps) {
  const layer = useContext(LayerContext)
  const [container] = useState(() => document.createElement('div'))
  const [open, setOpen] = useState(false)
  const offsetKey = JSON.stringify(offset ?? null)
  useEffect(() => {
    if (!layer) return
    const parsedOffset = JSON.parse(offsetKey) as PointExpression | null
    const tooltip = L.tooltip({
      ...(permanent === undefined ? {} : { permanent }),
      ...(direction === undefined ? {} : { direction }),
      ...(parsedOffset === null ? {} : { offset: parsedOffset }),
      ...(className === undefined ? {} : { className }),
    }).setContent(container)
    // Listening before binding: a permanent tooltip on a layer already on the
    // map opens inside bindTooltip() itself.
    const onOpen = () => setOpen(true)
    const onClose = () => setOpen(false)
    tooltip.on('add', onOpen)
    tooltip.on('remove', onClose)
    layer.bindTooltip(tooltip)
    return () => {
      tooltip.off('add', onOpen)
      tooltip.off('remove', onClose)
      layer.unbindTooltip()
    }
  }, [layer, container, permanent, direction, offsetKey, className])
  // Re-measured after each render while open, since the content may have
  // changed size -- including the first one, which fills a tooltip Leaflet has
  // just opened empty.
  useEffect(() => { if (open) layer?.getTooltip()?.update() })
  return open ? createPortal(children, container) : null
}
