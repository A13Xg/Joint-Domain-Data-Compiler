// Robust, locale-tolerant parsing helpers shared by all parsers and the UI.
//
// Reliability note: the original converter leaned on `new Date(value)` for every
// timestamp, which is implementation-defined for non-ISO strings. Here we parse
// the well-defined formats explicitly and only fall back to the engine for true
// ISO-8601, so output is deterministic across browser / Electron / Node.

export type TimeFormat =
  | 'auto'
  | 'iso'
  | 'epoch_seconds'
  | 'epoch_milliseconds'
  | 'epoch_microseconds'
  | 'excel_serial'

export type ElevationUnit = 'meters' | 'feet'

const EXCEL_EPOCH_OFFSET_DAYS = 25569 // days between 1899-12-30 and 1970-01-01
const MS_PER_DAY = 86_400_000

/**
 * Parse a possibly messy numeric string. Handles thousands separators and the
 * European decimal comma (e.g. "51,5074" => 51.5074, "1,234.5" => 1234.5).
 */
export function parseNumber(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  const trimmed = value.trim()
  if (!trimmed) return null

  // "12,34" (single comma, no dot) => decimal comma. Otherwise commas are grouping.
  const normalized = /^-?\d+,\d+$/.test(trimmed)
    ? trimmed.replace(',', '.')
    : trimmed.replaceAll(',', '')

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function convertElevationToMeters(value: number, unit: ElevationUnit): number {
  return unit === 'feet' ? value * 0.3048 : value
}

/**
 * Parse a coordinate that may be decimal degrees or DMS
 * (e.g. `47°37'13.8"N`, `47 37 13.8 N`, `-122.3493`, `W122.34`).
 * Returns decimal degrees or null.
 */
export function parseCoordinate(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null

  const value = raw.trim()
  if (!value) return null

  // Pure decimal degrees fast path.
  const direct = parseNumber(value)
  const dmsMatch = value.match(
    /^\s*([NSEW])?\s*(-?\d+(?:[.,]\d+)?)[°:\s]+(?:(\d+(?:[.,]\d+)?)['’:\s]*)?(?:(\d+(?:[.,]\d+)?)["”]?\s*)?([NSEW])?\s*$/i,
  )

  // Only treat as DMS if there is a hemisphere letter or multiple components.
  const hasHemisphere = /[NSEW]/i.test(value)
  const componentCount = (value.match(/\d+(?:[.,]\d+)?/g) ?? []).length

  if ((hasHemisphere || componentCount >= 2) && dmsMatch) {
    const hemi = (dmsMatch[1] || dmsMatch[5] || '').toUpperCase()
    const deg = parseNumber(dmsMatch[2]) ?? 0
    const min = parseNumber(dmsMatch[3] ?? '') ?? 0
    const sec = parseNumber(dmsMatch[4] ?? '') ?? 0
    let decimal = Math.abs(deg) + min / 60 + sec / 3600
    decimal *= deg < 0 ? -1 : 1
    if (hemi === 'S' || hemi === 'W') decimal = -Math.abs(decimal)
    else if (hemi === 'N' || hemi === 'E') decimal = Math.abs(decimal)
    return Number.isFinite(decimal) ? decimal : null
  }

  return direct
}

/** Parse a timestamp into epoch milliseconds (UTC) using an explicit format. */
export function parseTimeToEpochMs(
  raw: string | number | undefined | null,
  format: TimeFormat,
): number | null {
  if (raw === undefined || raw === null) return null
  const value = typeof raw === 'number' ? String(raw) : raw.trim()
  if (!value) return null

  if (format === 'auto') {
    return autoDetectEpochMs(value)
  }

  if (format === 'iso') {
    return parseIso(value)
  }

  const numeric = Number(value.replace(',', '.'))
  if (!Number.isFinite(numeric)) return null

  switch (format) {
    case 'epoch_seconds':
      return numeric * 1000
    case 'epoch_milliseconds':
      return numeric
    case 'epoch_microseconds':
      return numeric / 1000
    case 'excel_serial':
      return (numeric - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY
    default:
      return null
  }
}

function parseIso(value: string): number | null {
  // Accept "YYYY-MM-DD HH:MM:SS" (space) by normalizing to 'T'.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? value.replace(' ', 'T')
    : value
  const ms = Date.parse(normalized)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Best-effort detection used when the user leaves the format on "auto".
 * Disambiguates epoch seconds/ms/us and Excel serials by magnitude, then
 * falls back to ISO parsing.
 */
export function autoDetectEpochMs(value: string): number | null {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const abs = Math.abs(numeric)
    if (abs >= 1e14) return numeric / 1000 // microseconds
    if (abs >= 1e11) return numeric // milliseconds
    if (abs >= 1e9) return numeric * 1000 // seconds
    if (numeric > 20000 && numeric < 80000) {
      return (numeric - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY // Excel serial
    }
  }
  return parseIso(value)
}

/**
 * Format epoch milliseconds as a GPX-compliant UTC timestamp.
 * GPX consumers universally accept `YYYY-MM-DDTHH:MM:SSZ` (no milliseconds);
 * we include fractional seconds only when sub-second precision is present, as
 * the XSD's xsd:dateTime allows it and high-rate TSPI data needs it.
 */
export function epochMsToGpxTime(ms: number): string | null {
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  if (Number.isNaN(date.valueOf())) return null
  const iso = date.toISOString() // always ...Z
  return iso.endsWith('.000Z') ? iso.replace('.000Z', 'Z') : iso
}

export function epochMsToIso(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  return Number.isNaN(d.valueOf()) ? '' : d.toISOString()
}

/** XML-escape text for safe inclusion in element bodies and attributes. */
export function escapeXml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** Trim trailing zeros from a fixed-precision number to keep files compact. */
export function trimNumber(value: number, maxDecimals: number): string {
  if (!Number.isFinite(value)) return '0'
  const fixed = value.toFixed(maxDecimals)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes / 1024
  let i = 0
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[i]}`
}
