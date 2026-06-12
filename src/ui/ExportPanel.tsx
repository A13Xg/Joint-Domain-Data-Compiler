// Export surface: choose a target format, tune options, preview the serialized
// head, and download. GPX exposes the compatibility-critical knobs (sort, BOM,
// precision, extensions). GPB is offered for lossless binary round-tripping.
import { useMemo, useState } from 'react'
import type { Dataset } from '../core/model'
import { EXPORTERS, exportDataset, type ExportFormat } from '../core/exporters'
import { buildGpb } from '../core/parsers/gpb'
import { collectChannels } from '../core/model'
import { logger } from '../core/logger'

type Target = ExportFormat | 'gpb'

export function ExportPanel({ dataset }: { dataset: Dataset }) {
  const [target, setTarget] = useState<Target>('gpx')
  const [sortByTime, setSortByTime] = useState(true)
  const [bom, setBom] = useState(false)
  const [includeExtensions, setIncludeExtensions] = useState(true)
  const [precision, setPrecision] = useState(7)
  const [trackName, setTrackName] = useState(dataset.name.replace(/\.[^.]+$/, ''))

  const preview = useMemo(() => {
    if (target === 'gpb') {
      const buf = buildGpb(trackName, dataset.points, collectChannels(dataset.points))
      return { text: `«binary GPB container» ${buf.byteLength.toLocaleString()} bytes`, pointCount: dataset.points.length, warnings: [] as string[] }
    }
    try {
      const result = exportDataset(dataset, target, {
        gpx: { sortByTime, bom, includeExtensions, coordinatePrecision: precision, trackName },
      })
      return { text: result.text.slice(0, 1400), pointCount: result.pointCount, warnings: result.warnings }
    } catch (err) {
      return { text: `Export error: ${(err as Error).message}`, pointCount: 0, warnings: [] }
    }
  }, [dataset, target, sortByTime, bom, includeExtensions, precision, trackName])

  const descriptor = EXPORTERS.find((e) => e.id === target)

  const download = () => {
    try {
      let blob: Blob
      let ext: string
      if (target === 'gpb') {
        const buf = buildGpb(trackName, dataset.points, collectChannels(dataset.points))
        blob = new Blob([buf], { type: 'application/octet-stream' })
        ext = 'gpb'
      } else {
        const result = exportDataset(dataset, target, {
          gpx: { sortByTime, bom, includeExtensions, coordinatePrecision: precision, trackName },
        })
        blob = new Blob([result.text], { type: `${result.mime};charset=utf-8` })
        ext = result.extension
      }
      const fileName = `${trackName || 'track'}.${ext}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      logger.success('export', `Exported ${preview.pointCount.toLocaleString()} points to ${fileName}`, {
        format: target,
        bytes: blob.size,
      })
    } catch (err) {
      logger.error('export', `Export failed: ${(err as Error).message}`)
    }
  }

  return (
    <div className="export-panel">
      <div className="export-config">
        <div className="format-list">
          {[...EXPORTERS, { id: 'gpb', label: 'GPB (binary)', extension: 'gpb', mime: '', description: 'Lossless JDDC binary container for high-rate round-trips.' }].map((fmt) => (
            <button
              key={fmt.id}
              type="button"
              className={`format-card${target === fmt.id ? ' active' : ''}`}
              onClick={() => setTarget(fmt.id as Target)}
            >
              <span className="format-label">{fmt.label}</span>
              <span className="format-desc">{fmt.description}</span>
            </button>
          ))}
        </div>

        <div className="export-options">
          <label className="track-name-field">
            <span>output name</span>
            <input value={trackName} onChange={(e) => setTrackName(e.target.value)} />
            <span className="ext-tag">.{descriptor?.extension ?? target}</span>
          </label>

          {target === 'gpx' && (
            <div className="gpx-options">
              <label className="chk"><input type="checkbox" checked={sortByTime} onChange={(e) => setSortByTime(e.target.checked)} /> sort points by time</label>
              <label className="chk"><input type="checkbox" checked={includeExtensions} onChange={(e) => setIncludeExtensions(e.target.checked)} /> include extension channels</label>
              <label className="chk"><input type="checkbox" checked={bom} onChange={(e) => setBom(e.target.checked)} /> prepend UTF-8 BOM (legacy Windows)</label>
              <label className="num-field">
                <span>coordinate precision</span>
                <input type="number" min={4} max={9} value={precision} onChange={(e) => setPrecision(Number(e.target.value))} />
              </label>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="export-warnings">
              {preview.warnings.map((w, i) => (
                <p key={i} className="warn-line small">⚠ {w}</p>
              ))}
            </div>
          )}

          <button type="button" className="export-btn" onClick={download} disabled={dataset.points.length === 0}>
            Export {preview.pointCount.toLocaleString()} points
          </button>
        </div>
      </div>

      <div className="export-preview">
        <div className="preview-head">
          <span>preview</span>
          <span className="muted small">first 1.4 KB</span>
        </div>
        <pre className="preview-body mono">{preview.text}</pre>
      </div>
    </div>
  )
}
