// Spatial density overlay: which parts of the map the track actually dwelt in.
//
// A `useMap()` child rendering imperative Leaflet, the pattern MapView already
// uses for FitBounds, JumpToSelection, and InvalidateSizeOnResize. Cells are
// drawn through Leaflet's canvas renderer rather than as SVG paths — a busy
// track produces thousands of cells, and thousands of SVG rects make panning
// unusable.
//
// The binning itself lives in core/metrics/spatialBins.ts with no DOM
// dependency, so it stays unit-testable and the roadmap's multi-track
// divergence heatmaps can reuse it.

import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { canvas, layerGroup, rectangle } from 'leaflet'
import type { TrackPoint } from '../core/model'
import { binTrack } from '../core/metrics/spatialBins'
import { gradientColor } from './gradient'
import { logger } from '../core/logger'
import { errorMessage } from '../core/errors'

/** Matches MapView's own render budget so a dense track cannot stall the map. */
const MAX_RENDERED_CELLS = 4000

interface Props {
  points: readonly TrackPoint[]
  cellMeters: number
  opacity?: number
}

export function DensityLayer({ points, cellMeters, opacity = 0.55 }: Props) {
  const map = useMap()

  useEffect(() => {
    if (points.length === 0) return

    let result
    try {
      result = binTrack(points, cellMeters)
    } catch (error) {
      logger.warn('map', `Density overlay skipped: ${errorMessage(error)}`)
      return
    }
    if (result.max === 0) return

    // Cells arrive sorted ascending by count, so the tail is the busiest.
    // Trimming from the head keeps the hotspots — the thing the overlay
    // exists to show — rather than an arbitrary geographic slice.
    const visible = result.cells.length > MAX_RENDERED_CELLS
      ? result.cells.slice(result.cells.length - MAX_RENDERED_CELLS)
      : result.cells
    if (visible.length < result.cells.length) {
      logger.info('map', `Density overlay showing the ${MAX_RENDERED_CELLS.toLocaleString()} busiest of ${result.cells.length.toLocaleString()} cells; increase the cell size to see all of them`)
    }

    const renderer = canvas({ padding: 0.5 })
    const group = layerGroup([], { pane: 'overlayPane' })

    for (const cell of visible) {
      // Normalised against the busiest cell, so the scale is relative to this
      // track rather than an absolute count that means nothing across tracks.
      const intensity = cell.count / result.max
      group.addLayer(rectangle([[cell.south, cell.west], [cell.north, cell.east]], {
        renderer,
        stroke: false,
        fillColor: gradientColor(intensity),
        // Floor the alpha so a single-sample cell is still visible rather than
        // effectively invisible against the basemap.
        fillOpacity: opacity * (0.25 + 0.75 * intensity),
        interactive: false,
      }))
    }

    group.addTo(map)
    return () => {
      group.remove()
      // Leaflet attaches the canvas renderer to the map when the first path
      // using it is added, and leaves it there when the paths go away. Without
      // this, every toggle or cell-size change would strand another canvas in
      // the overlay pane.
      renderer.remove()
    }
  }, [map, points, cellMeters, opacity])

  return null
}
