// P5 CTS mission recording (.msnP5) importer.
//
// The container is fully decoded (docs/P5-MSN.md); the *coordinate frame* is not.
// Samples are a smooth 3-D Cartesian triple in a range-local frame whose origin
// and unit scale are not recorded anywhere in the file. So this parser does not
// guess: it takes the georeference as an explicit parameter, applies it, and
// warns on every import that the resulting latitudes and longitudes rest on that
// assumption. The raw frame values are always preserved as `p5_x/p5_y/p5_z`
// channels so a later, better georeference can be applied without re-importing.
import type { ChannelDefinition, ParseResult, TrackPoint } from '../model'
import { enuToGeodetic } from '../geodesy'
import {
  iterateP5Samples,
  readP5Document,
  type P5Document,
  type P5Participant,
} from '../p5/document'

export interface P5GeoReference {
  /** Latitude the anchor frame point is placed at, decimal degrees. */
  anchorLatDeg: number
  anchorLonDeg: number
  /** Height of the anchor point in metres. */
  anchorHeightM: number
  /**
   * Frame coordinates that the anchor corresponds to. Omit to anchor on the
   * first live sample of the *recording*, which for a ramp-start mission is the
   * parking spot — a point the operator can identify on a chart.
   */
  anchorX?: number
  anchorY?: number
  anchorZ?: number
  /** Metres per horizontal frame unit. */
  horizontalUnitMeters: number
  /** Metres per vertical frame unit. Demonstrably different from the horizontal one. */
  verticalUnitMeters: number
  /** Which frame axis is East. Unverified either way; see docs/P5-MSN.md §6. */
  axisOrder: 'x-east' | 'y-east'
}

/**
 * A plausible western-US range placement and nothing more authoritative than
 * that — the file records no origin, so *something* has to be assumed and this
 * is the assumption, stated out loud rather than hidden. 30.48 m/unit sits at
 * the low end of the 30–46 m band the specimen's path-length integration
 * supports and is a real unit (100 ft); 1 m/unit for the vertical axis sits
 * inside the 1/10–1/30 ratio the climb profile forces. Every field here is
 * meant to be overridden by an operator who knows the range reference point.
 */
export const P5_DEFAULT_GEOREFERENCE: P5GeoReference = {
  anchorLatDeg: 39.4166,
  anchorLonDeg: -118.7005,
  anchorHeightM: 1199,
  horizontalUnitMeters: 30.48,
  verticalUnitMeters: 1,
  axisOrder: 'x-east',
}

export interface ParseP5Options {
  /** Companion .rpt index, when the caller has it. */
  rpt?: Uint8Array
  georeference?: Partial<P5GeoReference>
  /** Restrict the import to these roster slots. Defaults to every live slot. */
  slots?: number[]
  /** Keep one sample in N (1 = full 10 Hz). */
  decimation?: number
  maxPoints?: number
}

function describeParticipant(participant: P5Participant | undefined, slot: number): string {
  if (!participant) return `Slot ${slot}`
  const callsign = participant.callsign.trim()
  const id = participant.aircraftId.trim()
  if (callsign && id) return `${callsign} ${id}`
  return callsign || id || `Slot ${slot}`
}

const CHANNEL_DEFINITIONS: ChannelDefinition[] = [
  { id: 'p5_slot', displayName: 'P5 slot', dataType: 'number', interpolation: 'step', description: 'Roster slot (1–50) the sample came from.' },
  { id: 'p5_x', displayName: 'Frame X', dataType: 'number', unit: 'frame units', interpolation: 'linear', description: 'Raw range-local X. Unit unresolved — see docs/P5-MSN.md §6.' },
  { id: 'p5_y', displayName: 'Frame Y', dataType: 'number', unit: 'frame units', interpolation: 'linear', description: 'Raw range-local Y. Unit unresolved.' },
  { id: 'p5_z', displayName: 'Frame Z', dataType: 'number', unit: 'frame units', interpolation: 'linear', description: 'Raw range-local vertical. Confirmed vertical axis; unit unresolved.' },
  { id: 'p5_field_a', displayName: 'P5 field A (rec+20)', dataType: 'number', interpolation: 'linear', description: 'Undecoded float. Constant along straight legs; not heading, not speed.' },
  { id: 'p5_field_b', displayName: 'P5 field B (rec+24)', dataType: 'number', interpolation: 'linear', description: 'Undecoded float. Monotonic with vertical rate; ~12.5 when level.' },
  { id: 'p5_field_c', displayName: 'P5 field C (rec+28)', dataType: 'number', interpolation: 'linear', description: 'Undecoded float. Oscillates with a several-second period.' },
  { id: 'p5_int_2', displayName: 'P5 int[2] (rec+36)', dataType: 'number', interpolation: 'linear', description: 'Undecoded int16. Correlates +0.996 with the vertical rate.' },
]

export function parseP5(buffer: ArrayBuffer | Uint8Array, options: ParseP5Options = {}): ParseResult {
  const doc = readP5Document(buffer, { rpt: options.rpt })
  return buildResultFromDocument(doc, options)
}

/** Split out so a caller that already holds a P5Document does not re-read 400 MB. */
export function buildResultFromDocument(doc: P5Document, options: ParseP5Options = {}): ParseResult {
  const geo: P5GeoReference = { ...P5_DEFAULT_GEOREFERENCE, ...options.georeference }
  const warnings = [...doc.warnings]

  if (doc.liveSlots.length === 0) {
    warnings.push('No roster slot in this recording carries live samples; the file contains only configuration.')
  }

  // An explicitly supplied (even empty) slot list means exactly those slots;
  // only an absent one means "everything that reports".
  const slots =
    options.slots === undefined ? doc.liveSlots : options.slots.filter((s) => doc.liveSlots.includes(s))
  const decimation = Math.max(1, Math.floor(options.decimation ?? 1))

  // The anchor is a property of the RECORDING, not of the track being built.
  // Anchoring each track on its own first sample would slide every track onto
  // the same starting coordinate and erase the geometry between them — which is
  // the whole point of a multi-ship recording. So the anchor is always resolved
  // across every live slot, whichever subset this call is rendering.
  let anchorX = geo.anchorX
  let anchorY = geo.anchorY
  let anchorZ = geo.anchorZ
  if (anchorX === undefined || anchorY === undefined || anchorZ === undefined) {
    const first = iterateP5Samples(doc, { maxSamples: 1 }).next()
    if (!first.done) {
      anchorX ??= first.value.x
      anchorY ??= first.value.y
      anchorZ ??= first.value.z
    } else {
      anchorX ??= 0
      anchorY ??= 0
      anchorZ ??= 0
    }
  }

  const origin = { latDeg: geo.anchorLatDeg, lonDeg: geo.anchorLonDeg, heightM: geo.anchorHeightM }
  const points: TrackPoint[] = []
  // Per-slot label and segment index are resolved once. Building them inside the
  // point loop allocated a fresh identical string for every one of a hundred
  // thousand samples.
  const segmentIndex = new Map<number, number>()
  const segmentLabel = new Map<number, string>()
  for (const slot of slots) {
    segmentIndex.set(slot, segmentIndex.size)
    segmentLabel.set(slot, describeParticipant(doc.roster.find((p) => p.slot === slot), slot))
  }

  const maxPoints = options.maxPoints ?? Number.MAX_SAFE_INTEGER
  let truncated = false

  for (const sample of iterateP5Samples(doc, { slots, decimation })) {
    if (points.length >= maxPoints) {
      truncated = true
      break
    }
    const dx = (sample.x - anchorX) * geo.horizontalUnitMeters
    const dy = (sample.y - anchorY) * geo.horizontalUnitMeters
    const up = (sample.z - anchorZ) * geo.verticalUnitMeters
    const enu =
      geo.axisOrder === 'x-east'
        ? { eastM: dx, northM: dy, upM: up }
        : { eastM: dy, northM: dx, upM: up }
    const geodetic = enuToGeodetic(enu, origin)

    points.push({
      lat: geodetic.latDeg,
      lon: geodetic.lonDeg,
      ele: geodetic.heightM,
      time: sample.time,
      provenance: {
        sourceRecord: sample.subframe + 1,
        sourceSegment: segmentLabel.get(sample.slot) ?? `Slot ${sample.slot}`,
        sourceFeatureIndex: segmentIndex.get(sample.slot) ?? 0,
        qualityFlags: ['p5_assumed_georeference'],
      },
      ext: {
        p5_slot: sample.slot,
        p5_x: sample.x,
        p5_y: sample.y,
        p5_z: sample.z,
        p5_field_a: sample.fieldA,
        p5_field_b: sample.fieldB,
        p5_field_c: sample.fieldC,
        p5_int_2: sample.ints[2] ?? 0,
      },
    })
  }

  if (truncated) {
    warnings.push(`Import stopped at ${maxPoints.toLocaleString()} points; increase the limit or raise the decimation factor to read the rest.`)
  }
  if (decimation > 1) {
    warnings.push(`Decimated to one sample every ${decimation} subframes (${(10 / decimation).toFixed(2)} Hz of the source 10 Hz).`)
  }

  warnings.push(
    `Coordinates are ASSUMED, not read from the file: the P5 range frame's origin and unit scale are not recorded in it. ` +
      `Applied ${geo.horizontalUnitMeters} m per horizontal unit, ${geo.verticalUnitMeters} m per vertical unit, ` +
      `${geo.axisOrder === 'x-east' ? 'X=East/Y=North' : 'Y=East/X=North'}, anchored at ` +
      `${geo.anchorLatDeg.toFixed(5)}, ${geo.anchorLonDeg.toFixed(5)}. Raw frame values are kept in the p5_x/p5_y/p5_z channels.`,
  )

  const meta: Record<string, string> = {
    p5MissionDate: doc.header.dateLong.trim() || doc.header.dateShort,
    p5Blocks: String(doc.blocks.length),
    p5Subframes: String(doc.subframeCount),
    p5RosterSlots: String(doc.roster.length),
    p5LiveSlots: doc.liveSlots.join(', ') || 'none',
    p5Roster: JSON.stringify(doc.roster),
    p5GeoReference: JSON.stringify({ ...geo, anchorX, anchorY, anchorZ }),
  }

  return {
    points,
    warnings,
    channels: CHANNEL_DEFINITIONS.map((c) => c.id),
    channelDefinitions: CHANNEL_DEFINITIONS,
    coordinateSystem: 'EPSG:4326 (derived from an assumed P5 range frame)',
    altitudeReference: 'HAE',
    timeReference: 'UTC',
    meta,
  }
}
