from pathlib import Path

root = Path(__file__).resolve().parents[1]

app = root / 'src' / 'App.tsx'
text = app.read_text(encoding='utf-8')
text = text.replace("import { analyzeRawRows } from './core/csvAnalysis'\n", '')
text = text.replace('  rawRows: string[][]\n', '')
text = text.replace(
    '  /** Manual header-row count override (null = auto-detect) when additionalHeaders is on. */\n'
    '  headerRowsOverride: number | null\n',
    '',
)
start_marker = '/** Re-default the mapping for a fresh analysis'
end_marker = 'export default function App()'
if start_marker in text:
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    text = text[:start] + text[end:]
app.write_text(text, encoding='utf-8')

transforms = root / 'src' / 'core' / 'transforms.ts'
text = transforms.read_text(encoding='utf-8')
old = """  for (let i = 0; i < out.length; i++) {
    const ext = out[i].ext ?? {}
    if (i === 0) {
      ext.distance_m = 0
      ext.speed_mps = 0
    } else {
      const prev = out[i - 1]
      const d = haversineMeters(prev.lat, prev.lon, out[i].lat, out[i].lon)
      cumDist += d
      ext.distance_m = Math.round(cumDist * 1000) / 1000
      if (out[i].time !== undefined && prev.time !== undefined) {
        const dt = (out[i].time - prev.time) / 1000
        if (dt > 0) {
          ext.speed_mps = Math.round((d / dt) * 1000) / 1000
        } else {
          delete ext.speed_mps
          addQualityFlag(out[i], dt === 0 ? 'duplicate_timestamp' : 'non_monotonic_timestamp')
        }
      }
      ext.heading_deg = Math.round(bearing(prev, out[i]) * 100) / 100
    }
    out[i].ext = ext
  }
"""
new = """  for (let i = 0; i < out.length; i++) {
    const current = out[i]
    if (!current) continue
    const ext = current.ext ?? {}
    if (i === 0) {
      ext.distance_m = 0
      ext.speed_mps = 0
    } else {
      const prev = out[i - 1]
      if (!prev) continue
      const d = haversineMeters(prev.lat, prev.lon, current.lat, current.lon)
      cumDist += d
      ext.distance_m = Math.round(cumDist * 1000) / 1000
      if (current.time !== undefined && prev.time !== undefined) {
        const dt = (current.time - prev.time) / 1000
        if (dt > 0) {
          ext.speed_mps = Math.round((d / dt) * 1000) / 1000
        } else {
          delete ext.speed_mps
          addQualityFlag(current, dt === 0 ? 'duplicate_timestamp' : 'non_monotonic_timestamp')
        }
      }
      ext.heading_deg = Math.round(bearing(prev, current) * 100) / 100
    }
    current.ext = ext
  }
"""
if old not in text:
    raise RuntimeError('Expected deriveKinematics block not found')
transforms.write_text(text.replace(old, new), encoding='utf-8')

table = root / 'src' / 'ui' / 'DataTable.tsx'
text = table.read_text(encoding='utf-8')
old = 'get: (p: TrackPoint) => number | string | undefined'
new = 'get: (p: TrackPoint) => number | string | boolean | undefined'
if old not in text:
    raise RuntimeError('Expected DataTable column type not found')
table.write_text(text.replace(old, new), encoding='utf-8')
