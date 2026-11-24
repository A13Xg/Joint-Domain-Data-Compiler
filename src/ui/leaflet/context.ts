// React context and hooks for the in-house Leaflet bindings in ./components.
//
// These replace react-leaflet, which is licensed under the Hippocratic License
// 2.1: an "ethical source" license with use restrictions that is not
// OSI-approved and cannot be combined with this project's AGPL-3.0 (whose
// section 10 forbids adding restrictions). Leaflet itself is BSD-2-Clause. The
// API mirrors the small part of react-leaflet the map used, so the map
// components only changed their import.
import { createContext, useContext, useEffect, useRef } from 'react'
import type { Evented, Layer, LeafletEventHandlerFn, LeafletEventHandlerFnMap, Map as LeafletMap } from 'leaflet'

export const MapContext = createContext<LeafletMap | null>(null)
/** The layer a <Tooltip> child binds to. */
export const LayerContext = createContext<Layer | null>(null)

export function useMap(): LeafletMap {
  const map = useContext(MapContext)
  if (!map) throw new Error('useMap() must be called inside <MapContainer>.')
  return map
}

/**
 * Keeps `target`'s Leaflet listeners pointing at the latest handlers without
 * re-binding on every render: callers pass inline objects, so the handlers are
 * new each time while the set of event names rarely changes.
 */
export function useLeafletEvents(target: Evented | null, handlers: LeafletEventHandlerFnMap | undefined): void {
  const latest = useRef(handlers)
  useEffect(() => { latest.current = handlers })
  const names = Object.keys(handlers ?? {}).sort().join(',')
  useEffect(() => {
    if (!target || !names) return
    const bound = names.split(',').map((name) => {
      const listener: LeafletEventHandlerFn = (event) => (latest.current as Record<string, LeafletEventHandlerFn | undefined> | undefined)?.[name]?.(event)
      target.on(name, listener)
      return [name, listener] as const
    })
    return () => { for (const [name, listener] of bound) target.off(name, listener) }
  }, [target, names])
}

export function useMapEvents(handlers: LeafletEventHandlerFnMap): LeafletMap {
  const map = useMap()
  useLeafletEvents(map, handlers)
  return map
}
