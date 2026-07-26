// GPB — "Geo Point Binary", a compact self-describing binary container for TSPI
// tracks. Many flight-test pipelines emit bespoke binary point streams; without a
// universal spec, JDDC defines a compact numeric container that it can read and
// write. GPB preserves the numeric fields represented by this layout, but it is
// not a complete lossless workspace or metadata format.
//
// Layout (all little-endian):
//   magic      : 4 bytes  = "GPB1"
//   version    : uint8    = 1
//   flags      : uint8    bit0 hasTime, bit1 hasEle
//   nameLen    : uint16   length of UTF-8 track name
//   name       : nameLen bytes
//   channelCnt : uint16   number of extra numeric channels
//   channels[] : repeated { uint8 keyLen, key bytes (UTF-8) }
//   pointCount : uint32
//   points[]   : repeated record:
//                  float64 lat, float64 lon
//                  [float32 ele]   if hasEle
//                  [float64 time]  if hasTime (epoch ms)
//                  float32 channelValue * channelCnt
import type { ParseResult, TrackPoint } from '../model'

const MAGIC = 'GPB1'
const FLAG_TIME = 0x01
const FLAG_ELE = 0x02

export function looksLikeGpb(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x47 && // G
    bytes[1] === 0x50 && // P
    bytes[2] === 0x42 && // B
    bytes[3] === 0x31 // 1
  )
}

export function parseGpb(buffer: ArrayBuffer): ParseResult {
  const bytes = new Uint8Array(buffer)
  if (!looksLikeGpb(bytes)) {
    throw new Error(
      'Unrecognized binary (.gpb) file: missing "GPB1" magic header. Only the ' +
        'documented JDDC GPB container is supported for binary import. Convert via ' +
        'a known text format (CSV/GPX/NMEA) if this is a vendor-specific binary.',
    )
  }

  const view = new DataView(buffer)
  let offset = 4
  const version = view.getUint8(offset); offset += 1
  if (version !== 1) throw new Error(`Unsupported GPB version ${version}.`)
  const flags = view.getUint8(offset); offset += 1
  const hasTime = (flags & FLAG_TIME) !== 0
  const hasEle = (flags & FLAG_ELE) !== 0

  const nameLen = view.getUint16(offset, true); offset += 2
  const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLen))
  offset += nameLen

  const channelCount = view.getUint16(offset, true); offset += 2
  const channels: string[] = []
  for (let i = 0; i < channelCount; i++) {
    const keyLen = view.getUint8(offset); offset += 1
    channels.push(new TextDecoder().decode(bytes.subarray(offset, offset + keyLen)))
    offset += keyLen
  }

  const pointCount = view.getUint32(offset, true); offset += 4
  const points: TrackPoint[] = []
  for (let i = 0; i < pointCount; i++) {
    const lat = view.getFloat64(offset, true); offset += 8
    const lon = view.getFloat64(offset, true); offset += 8
    const point: TrackPoint = { lat, lon }
    if (hasEle) { point.ele = view.getFloat32(offset, true); offset += 4 }
    if (hasTime) { point.time = view.getFloat64(offset, true); offset += 8 }
    if (channelCount > 0) {
      const ext: Record<string, number> = {}
      for (const key of channels) {
        ext[key] = view.getFloat32(offset, true); offset += 4
      }
      point.ext = ext
    }
    points.push(point)
  }

  return { points, warnings: [], channels, meta: { trackName: name } }
}

export function buildGpb(name: string, points: TrackPoint[], channels: string[]): ArrayBuffer {
  const hasTime = points.some((p) => p.time !== undefined)
  const hasEle = points.some((p) => p.ele !== undefined)
  const nameBytes = new TextEncoder().encode(name)
  const channelKeyBytes = channels.map((c) => new TextEncoder().encode(c))

  let size = 4 + 1 + 1 + 2 + nameBytes.length + 2
  for (const kb of channelKeyBytes) size += 1 + kb.length
  size += 4
  const perPoint = 16 + (hasEle ? 4 : 0) + (hasTime ? 8 : 0) + channels.length * 4
  size += perPoint * points.length

  const buffer = new ArrayBuffer(size)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  bytes.set(new TextEncoder().encode(MAGIC), 0); offset += 4
  view.setUint8(offset, 1); offset += 1
  view.setUint8(offset, (hasTime ? FLAG_TIME : 0) | (hasEle ? FLAG_ELE : 0)); offset += 1
  view.setUint16(offset, nameBytes.length, true); offset += 2
  bytes.set(nameBytes, offset); offset += nameBytes.length
  view.setUint16(offset, channels.length, true); offset += 2
  for (const kb of channelKeyBytes) {
    view.setUint8(offset, kb.length); offset += 1
    bytes.set(kb, offset); offset += kb.length
  }
  view.setUint32(offset, points.length, true); offset += 4

  for (const p of points) {
    view.setFloat64(offset, p.lat, true); offset += 8
    view.setFloat64(offset, p.lon, true); offset += 8
    if (hasEle) { view.setFloat32(offset, p.ele ?? 0, true); offset += 4 }
    if (hasTime) { view.setFloat64(offset, p.time ?? 0, true); offset += 8 }
    for (const key of channels) {
      const v = p.ext?.[key]
      view.setFloat32(offset, typeof v === 'number' ? v : Number(v) || 0, true)
      offset += 4
    }
  }

  return buffer
}
