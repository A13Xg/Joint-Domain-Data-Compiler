// P5 CTS mission recording (.msnP5) exporter.
//
// Export is a patch-and-emit, not a serializer: most of an 88-byte slot record
// and every subframe header/trailer is still undecoded (docs/P5-MSN.md §8), so
// regenerating a file from the Dataset model would silently invent bytes. The
// exporter instead writes edits back into the source document and re-emits it,
// which makes an unedited export byte-identical to the file that was imported.
import type { Dataset, TrackPoint } from '../model'
import { enuToGeodetic, geodeticToEnu } from '../geodesy'
import {
  P5_STATE_LIVE,
  buildP5Rpt,
  p5RecordOffset,
  setP5Participant,
  setP5SamplePosition,
  validateParticipantPatch,
  type P5Document,
  type ParticipantPatch,
} from '../p5/document'
import { P5_DEFAULT_GEOREFERENCE, type P5GeoReference } from '../parsers/p5'

export interface P5RosterEdit extends ParticipantPatch {
  slot: number
}

export interface P5ExportOptions {
  /** Roster field edits to apply before emitting. Applied all-or-nothing. */
  roster?: P5RosterEdit[]
  /**
   * Datasets whose points should be written back into the recording. Only points
   * that actually moved are written.
   *
   * Each dataset is inverted with the georeference **recorded in its own
   * metadata** — the one it was built with. There is deliberately no override:
   * inverting a track's coordinates through a georeference it was not built with
   * silently rewrites every sample in it under a mismatched transform. A caller
   * that wants a different georeference re-derives the points with it first.
   */
  datasets?: Dataset[]
}

export interface P5ExportResult {
  msn: Uint8Array
  rpt: Uint8Array
  /** The companion .teq as imported, when one was supplied. Never modified. */
  teq?: Uint8Array
  /** Slot records whose position was rewritten. */
  positionsWritten: number
  /** Roster slots whose identity fields were rewritten. */
  rosterWritten: number
  warnings: string[]
}

/**
 * "Has this point moved?" is decided in geodetic space, not frame space, and
 * against the *forward* conversion of the bytes currently in the record — the
 * identical computation the importer ran. An untouched point therefore compares
 * equal to within floating-point noise and is never rewritten, which is what
 * makes an unedited export byte-identical. Deciding it in frame space instead
 * would compare an inverted value against the stored one, and the geodetic round
 * trip is not bit-exact: a handful of samples per hundred thousand drift far
 * enough to be mistaken for edits.
 *
 * The thresholds are ~0.01 mm of arc and 1 µm of height: far below any edit a
 * user can make, far above the noise.
 */
const DEGREE_EPSILON = 1e-10
const HEIGHT_EPSILON_M = 1e-6

function movedInGeodeticSpace(
  point: TrackPoint,
  reference: { latDeg: number; lonDeg: number; heightM: number },
): boolean {
  return (
    Math.abs(point.lat - reference.latDeg) > DEGREE_EPSILON ||
    Math.abs(point.lon - reference.lonDeg) > DEGREE_EPSILON ||
    Math.abs((point.ele ?? reference.heightM) - reference.heightM) > HEIGHT_EPSILON_M
  )
}

/**
 * The georeference a dataset was built with. Returns `null` when its metadata is
 * missing or unreadable, because falling back to the defaults would invert the
 * points through a transform they were never in — the caller skips the dataset
 * and says so instead.
 */
export function readDatasetGeoReference(dataset: Dataset): P5GeoReference | null {
  const stored = dataset.metadata?.meta?.p5GeoReference
  if (!stored) return null
  try {
    return { ...P5_DEFAULT_GEOREFERENCE, ...(JSON.parse(stored) as Partial<P5GeoReference>) }
  } catch {
    return null
  }
}

export function buildP5Export(document: P5Document, options: P5ExportOptions = {}): P5ExportResult {
  const warnings: string[] = []
  let rosterWritten = 0
  let positionsWritten = 0

  // Validate the whole batch before touching a byte: a throw halfway through
  // would leave the in-memory recording in a state the UI never displayed.
  const rosterEdits = (options.roster ?? []).filter(
    (edit) => edit.aircraftId !== undefined || edit.unit !== undefined || edit.callsign !== undefined || edit.typeCode !== undefined,
  )
  for (const { slot, ...patch } of rosterEdits) validateParticipantPatch(slot, patch)
  for (const { slot, ...patch } of rosterEdits) {
    setP5Participant(document, slot, patch)
    rosterWritten++
  }

  for (const dataset of options.datasets ?? []) {
    const geo = readDatasetGeoReference(dataset)
    if (!geo || geo.anchorX === undefined || geo.anchorY === undefined || geo.anchorZ === undefined) {
      warnings.push(
        `${dataset.name}: no usable P5 georeference recorded in the dataset metadata, so its points cannot be ` +
          'inverted back into range-frame units. Positions in this dataset were not written.',
      )
      continue
    }
    const origin = { latDeg: geo.anchorLatDeg, lonDeg: geo.anchorLonDeg, heightM: geo.anchorHeightM }
    let unaddressable = 0

    for (const point of dataset.points) {
      const offset = resolveRecordOffset(document, point)
      if (offset < 0) {
        unaddressable++
        continue
      }
      if (document.view.getUint16(offset, false) !== P5_STATE_LIVE) {
        unaddressable++
        continue
      }
      // Forward-convert what is in the file right now and compare like for like.
      const currentX = document.view.getFloat32(offset + 8, false)
      const currentY = document.view.getFloat32(offset + 12, false)
      const currentZ = document.view.getFloat32(offset + 16, false)
      const currentEnu =
        geo.axisOrder === 'x-east'
          ? {
              eastM: (currentX - geo.anchorX) * geo.horizontalUnitMeters,
              northM: (currentY - geo.anchorY) * geo.horizontalUnitMeters,
              upM: (currentZ - geo.anchorZ) * geo.verticalUnitMeters,
            }
          : {
              eastM: (currentY - geo.anchorY) * geo.horizontalUnitMeters,
              northM: (currentX - geo.anchorX) * geo.horizontalUnitMeters,
              upM: (currentZ - geo.anchorZ) * geo.verticalUnitMeters,
            }
      if (!movedInGeodeticSpace(point, enuToGeodetic(currentEnu, origin))) continue

      const enu = geodeticToEnu({ latDeg: point.lat, lonDeg: point.lon, heightM: point.ele ?? 0 }, origin)
      const east = enu.eastM / geo.horizontalUnitMeters
      const north = enu.northM / geo.horizontalUnitMeters
      setP5SamplePosition(document, offset, {
        x: geo.axisOrder === 'x-east' ? east + geo.anchorX : north + geo.anchorX,
        y: geo.axisOrder === 'x-east' ? north + geo.anchorY : east + geo.anchorY,
        z: enu.upM / geo.verticalUnitMeters + geo.anchorZ,
      })
      positionsWritten++
    }

    if (unaddressable > 0) {
      warnings.push(
        `${dataset.name}: ${unaddressable.toLocaleString()} points could not be matched to a live slot record ` +
          '(points added after import, or records the recording marks as no-data) and were not written.',
      )
    }
  }

  return {
    msn: document.bytes,
    rpt: buildP5Rpt(document),
    teq: document.teq,
    positionsWritten,
    rosterWritten,
    warnings,
  }
}

/** Map an imported point back to the slot record it came from. */
function resolveRecordOffset(document: P5Document, point: TrackPoint): number {
  const record = point.provenance?.sourceRecord
  const slot = point.ext?.p5_slot
  if (typeof record !== 'number' || typeof slot !== 'number') return -1
  // sourceRecord is the 1-based subframe ordinal the importer wrote.
  return p5RecordOffset(document, record - 1, slot)
}
