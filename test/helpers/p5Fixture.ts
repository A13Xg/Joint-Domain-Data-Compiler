// Builds a small but structurally genuine .msnP5 in memory.
//
// The real specimen this format was decoded from is operational range data and
// is not in this repository (see docs/P5-MSN.md), so every roster value, date
// and clock below is a synthetic stand-in of the right *shape* — the callsign
// with a trailing space and the two slots sharing a callsign are both there
// because the parser has to handle them, not because they came from a real
// sortie. The layout itself is genuine: block sizing, the subframe signature,
// the 10 Hz clock, the 50-slot record grid and the no-data sentinel are all
// reproduced exactly, at three blocks instead of thousands, so the tests
// exercise real layout arithmetic rather than a mock.
import {
  P5_BLOCK0_BYTES,
  P5_BLOCK0_CONFIG_BYTES,
  P5_BLOCK_BYTES,
  P5_BLOCK_HEADER_BYTES,
  P5_NO_DATA_SENTINEL,
  P5_RECORD_BYTES,
  P5_ROSTER_OFFSET,
  P5_ROSTER_RECORD_BYTES,
  P5_SLOT_COUNT,
  P5_SUBFRAME_BYTES,
  P5_SUBFRAME_HEADER_BYTES,
  P5_SUBFRAME_TRAILER_BYTES,
  encodeP5Clock,
} from '../../src/core/p5/document.ts'

export interface FixtureSlot {
  slot: number
  aircraftId: string
  unit: string
  callsign: string
  typeCode: number
  /** Live slots get a synthetic trajectory; others stay at the no-data sentinel. */
  live: boolean
}

export interface FixtureOptions {
  /** Blocks after block 0. Each is one mission second at 10 Hz. */
  extraBlocks?: number
  startTimeOfDayMs?: number
  dateShort?: string
  dateLong?: string
  slots?: FixtureSlot[]
}

export const DEFAULT_FIXTURE_SLOTS: FixtureSlot[] = [
  { slot: 1, aircraftId: '401', unit: 'TESTSQA', callsign: 'ALPHA', typeCode: 0x58, live: true },
  // Same callsign as slot 1, different aircraft: the real format allows it, and
  // it is what makes the slot number load-bearing in a track label.
  { slot: 2, aircraftId: '5502', unit: 'TESTSQA', callsign: 'ALPHA', typeCode: 0x58, live: true },
  // Trailing space is deliberate — a real callsign field can end in one and it
  // has to survive a read/write round-trip.
  { slot: 3, aircraftId: '618', unit: 'TESTSQB', callsign: 'BRAVOFLT ', typeCode: 0x5f, live: false },
]

function writeAscii(bytes: Uint8Array, offset: number, length: number, value: string): void {
  for (let i = 0; i < length; i++) bytes[offset + i] = i < value.length ? value.charCodeAt(i) & 0x7f : 0
}

function writeSubframeShell(bytes: Uint8Array, view: DataView, offset: number, timeOfDayMs: number): void {
  view.setUint32(offset, 0x00000452, false)
  view.setUint32(offset + 4, 0x04010003, false)
  encodeP5Clock(bytes, offset + 8, timeOfDayMs)
  // Second clock: a real recording runs this one ahead of the data-valid clock
  // by a fixed offset. Nothing reads it; it is here so the 20-byte header is
  // shaped like a real one.
  encodeP5Clock(bytes, offset + 12, (timeOfDayMs + 3_600_000) % 86_400_000)
  view.setUint32(offset + 16, 0x0332044e, false)

  const trailer = offset + P5_SUBFRAME_HEADER_BYTES + P5_SLOT_COUNT * P5_RECORD_BYTES
  view.setUint32(trailer, 0x0332457d, false)
  bytes[trailer + 4] = 0xff
  for (let i = 0; i < 16; i++) view.setUint32(trailer + 8 + i * 4, (i + 1) << 16, false)
}

function writeRecords(
  bytes: Uint8Array,
  view: DataView,
  recordsBase: number,
  subframeOrdinal: number,
  slots: FixtureSlot[],
): void {
  for (let k = 0; k < P5_SLOT_COUNT; k++) {
    const rec = recordsBase + k * P5_RECORD_BYTES
    const spec = slots.find((s) => s.slot === k + 1)
    bytes[rec + 7] = k + 1
    if (spec?.live) {
      view.setUint16(rec, 0x0000, false)
      view.setUint16(rec + 4, 0x005a, false)
      bytes[rec + 6] = 0x00
      // A gentle, strictly monotonic trajectory: enough to be interpolable and
      // to make an edit to one sample visibly local.
      const t = subframeOrdinal / 10
      view.setFloat32(rec + 8, 3000 + t * 3 + spec.slot * 10, false)
      view.setFloat32(rec + 12, -4000 + t * 5, false)
      view.setFloat32(rec + 16, -610 + t * 2, false)
      view.setFloat32(rec + 20, 42.5, false)
      view.setFloat32(rec + 24, 12.25, false)
      view.setFloat32(rec + 28, -3.5, false)
      for (let j = 0; j < 8; j++) view.setInt16(rec + 32 + j * 2, j === 2 ? 20 : j, false)
    } else {
      view.setUint16(rec, 0x0001, false)
      view.setUint16(rec + 4, 0x0000, false)
      // Stable per-slot status byte the exporter must preserve rather than derive.
      bytes[rec + 6] = 0x6f
      view.setUint32(rec + 8, P5_NO_DATA_SENTINEL, false)
      view.setUint32(rec + 12, P5_NO_DATA_SENTINEL, false)
    }
  }
}

export function buildP5Fixture(options: FixtureOptions = {}): { msn: Uint8Array; rpt: Uint8Array } {
  const extraBlocks = options.extraBlocks ?? 2
  const startTimeOfDayMs = options.startTimeOfDayMs ?? ((9 * 60 + 15) * 60 + 30) * 1000
  const slots = options.slots ?? DEFAULT_FIXTURE_SLOTS

  const total = P5_BLOCK0_BYTES + extraBlocks * P5_BLOCK_BYTES
  const msn = new Uint8Array(total)
  const view = new DataView(msn.buffer)

  // ---- block 0: file header, roster, config trailer, then 9 subframes ----
  view.setUint32(0, 0x00000100, false)
  encodeP5Clock(msn, 8, startTimeOfDayMs)
  view.setUint32(16, 0x04010003, false)
  encodeP5Clock(msn, 20, startTimeOfDayMs)
  writeAscii(msn, 32, 8, options.dateShort ?? '09/17/26')
  writeAscii(msn, 48, 16, options.dateLong ?? '17 SEP 26 ')

  for (let i = 0; i < P5_SLOT_COUNT; i++) {
    const base = P5_ROSTER_OFFSET + i * P5_ROSTER_RECORD_BYTES
    const spec = slots.find((s) => s.slot === i + 1)
    view.setUint16(base, 0x0102, false)
    msn[base + 2] = i + 1
    msn[base + 3] = spec?.typeCode ?? 0x5f
    view.setUint16(base + 4, 743 - i, false)
    view.setUint32(base + 6, 0x00000007, false)
    view.setUint16(base + 10, i + 1, false)
    writeAscii(msn, base + 12, 8, spec?.aircraftId ?? String(1000 + i))
    writeAscii(msn, base + 20, 8, spec?.unit ?? 'TESTSQC')
    writeAscii(msn, base + 28, 20, spec?.callsign ?? 'CHARLIE')
  }

  // Block 0's config region ends with a standard subframe trailer.
  const configTrailer = P5_BLOCK_HEADER_BYTES + P5_BLOCK0_CONFIG_BYTES - P5_SUBFRAME_TRAILER_BYTES
  view.setUint32(configTrailer, 0x1c8a55b5, false)
  msn[configTrailer + 4] = 0xff
  for (let i = 0; i < 16; i++) view.setUint32(configTrailer + 8 + i * 4, (i + 1) << 16, false)

  let subframeOrdinal = 0
  const emitBlock = (blockOffset: number, firstSubframeOffset: number, count: number) => {
    for (let s = 0; s < count; s++) {
      const offset = firstSubframeOffset + s * P5_SUBFRAME_BYTES
      const timeOfDayMs = (startTimeOfDayMs + subframeOrdinal * 100) % 86_400_000
      writeSubframeShell(msn, view, offset, timeOfDayMs)
      writeRecords(msn, view, offset + P5_SUBFRAME_HEADER_BYTES, subframeOrdinal, slots)
      if (s === count - 1) encodeP5Clock(msn, blockOffset + 8, timeOfDayMs)
      subframeOrdinal++
    }
  }

  emitBlock(0, P5_BLOCK_HEADER_BYTES + P5_BLOCK0_CONFIG_BYTES, 9)
  for (let b = 0; b < extraBlocks; b++) {
    const blockOffset = P5_BLOCK0_BYTES + b * P5_BLOCK_BYTES
    emitBlock(blockOffset, blockOffset + P5_BLOCK_HEADER_BYTES, 10)
  }

  // ---- .rpt: header + contiguous index, preallocated like a real one ----
  const blockCount = 1 + extraBlocks
  const rpt = new Uint8Array(0x0fc0 + 4096)
  const rptView = new DataView(rpt.buffer)
  rptView.setUint32(0, blockCount, false)
  rptView.setUint32(4, 2, false)
  writeAscii(rpt, 8, 8, options.dateShort ?? '09/17/26')
  writeAscii(rpt, 16, 16, options.dateLong ?? '17 SEP 26 ')
  let offset = 0
  for (let i = 0; i < blockCount; i++) {
    const size = i === 0 ? P5_BLOCK0_BYTES : P5_BLOCK_BYTES
    rptView.setUint32(0x0fc0 + i * 8, size, false)
    rptView.setUint32(0x0fc0 + i * 8 + 4, offset, false)
    offset += size
  }
  return { msn, rpt }
}
