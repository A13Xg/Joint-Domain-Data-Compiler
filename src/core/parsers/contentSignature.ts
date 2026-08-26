// Cheap, format-agnostic content sniffing. This does not replace a parser —
// it exists only to warn when a file's extension and its actual content
// disagree (a renamed export, a mislabeled log, a copy/paste mistake), so the
// mismatch is visible instead of silently normalized or silently rejected.
import type { SourceFormat } from '../model'
import { looksLikeGpb } from './gpb'

export type ContentSignature = SourceFormat | 'unknown'

const SNIFF_WINDOW = 4096

export function sniffTextSignature(text: string): ContentSignature {
  const head = text.slice(0, SNIFF_WINDOW).trimStart()

  if (head.startsWith('{') || head.startsWith('[')) {
    return /"type"\s*:\s*"(feature|featurecollection|point|linestring|multilinestring|polygon|multipoint|geometrycollection)"/i.test(head)
      ? 'geojson'
      : 'unknown'
  }
  if (/<\s*gpx[\s>]/i.test(head)) return 'gpx'
  if (
    /<\s*kml[\s>]/i.test(head) ||
    /xmlns=["']http:\/\/(www\.)?opengis\.net\/kml/i.test(head) ||
    /xmlns=["']http:\/\/earth\.google\.com\/kml/i.test(head)
  ) {
    return 'kml'
  }
  if (/^\$[A-Za-z]{5},/m.test(head)) return 'nmea'

  const lines = head.split(/\r?\n/)
  const firstLine = lines[0] ?? ''
  const secondLine = lines[1] ?? ''

  // EAG header: 7 tab-separated fields on first line, 11 on data rows
  if (firstLine && /\t/.test(firstLine)) {
    const headerFields = firstLine.split('\t')
    const dataFields = secondLine.split('\t')
    if (headerFields.length === 7 && dataFields.length === 11) {
      return 'eag'
    }
  }

  if (/[,\t;]/.test(firstLine) && !/^\s*</.test(firstLine)) return 'csv'

  return 'unknown'
}

export function sniffBinarySignature(bytes: Uint8Array): ContentSignature {
  return looksLikeGpb(bytes) ? 'gpb' : 'unknown'
}

/** Formats whose sniffed shape legitimately overlaps and should not warn. */
const COMPATIBLE_SIGNATURES: Partial<Record<SourceFormat, ContentSignature[]>> = {
  kml: ['unknown'], // KMZ (zip) content sniffs as unknown text before extraction.
}

export function describeSignatureMismatch(declared: SourceFormat, sniffed: ContentSignature): string | null {
  if (sniffed === 'unknown' || sniffed === declared) return null
  if (COMPATIBLE_SIGNATURES[declared]?.includes(sniffed)) return null
  return `File extension declares ${declared.toUpperCase()} but content looks like ${sniffed.toUpperCase()}. Proceeding with the declared format — verify this is the intended file.`
}
