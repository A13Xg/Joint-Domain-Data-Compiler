// Export surface: choose a target format, tune options, preview the serialized
// head, and download. GPX exposes the compatibility-critical knobs (sort, BOM,
// precision, extensions). GPB is offered for lossless binary round-tripping.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dataset } from '../core/model'
import { EXPORTERS, exportDataset, type ExportFormat } from '../core/exporters'
import { buildGpb } from '../core/parsers/gpb'
import { collectChannels } from '../core/model'
import { logger } from '../core/logger'
import { ComputeClient, type ComputeRunHandle } from '../compute/client'
import { createGpxExportWorker, runGpxExport, shouldUseGpxExportWorker } from '../compute/gpxExportClient'
import type { GpxBuildResult } from '../core/exporters/gpx'

type Target = ExportFormat | 'gpb'

export function ExportPanel({ dataset }: { dataset: Dataset }) {
  const [target, setTarget] = useState<Target>('gpx')
  const [sortByTime, setSortByTime] = useState(true)
  const [bom, setBom] = useState(false)
  const [includeExtensions, setIncludeExtensions] = useState(true)
  const [precision, setPrecision] = useState(7)
  const [trackName, setTrackName] = useState(dataset.name.replace(/\.[^.]+$/, ''))
  const [acknowledgedNotional, setAcknowledgedNotional] = useState(false)
  // Reset the acknowledgment during render when the dataset changes, rather
  // than in an effect — same pattern used elsewhere (MapView's basemap
  // status, App.tsx's display-settings sync).
  const [trackedDatasetId, setTrackedDatasetId] = useState(dataset.id)
  if (dataset.id !== trackedDatasetId) {
    setTrackedDatasetId(dataset.id)
    setAcknowledgedNotional(false)
  }
  const notionalCount = useMemo(() => dataset.points.filter((p) => p.ext?.notional === true).length, [dataset.points])
  const exportBlocked = notionalCount > 0 && !acknowledgedNotional

  const computeClientRef = useRef<ComputeClient | null>(null)
  const activeGpxExportRef = useRef<ComputeRunHandle<GpxBuildResult> | null>(null)
  const [gpxExportProgress, setGpxExportProgress] = useState<string | null>(null)
  useEffect(() => () => computeClientRef.current?.dispose(), [])

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

  const saveBlob = (blob: Blob, fileName: string, format: Target, pointCount: number, warnings: string[] = []) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    for (const w of warnings) logger.warn('export', w)
    logger.success('export', `Exported ${pointCount.toLocaleString()} points to ${fileName}`, {
      format,
      bytes: blob.size,
    })
  }

  // Large GPX exports run on the shared compute Worker (chunked, cancellable,
  // byte-identical to the synchronous buildGpx) instead of blocking the
  // renderer thread. Mirrors TransformPanel's runResample wiring.
  const downloadGpxViaWorker = async () => {
    try {
      if (!computeClientRef.current) {
        computeClientRef.current = new ComputeClient(createGpxExportWorker())
      }
      setGpxExportProgress('Starting GPX export worker')
      const handle = runGpxExport(
        computeClientRef.current,
        {
          points: dataset.points,
          datasetName: dataset.name,
          options: { sortByTime, bom, includeExtensions, coordinatePrecision: precision, trackName },
        },
        { onProgress: (progress) => setGpxExportProgress(progress.message ?? `${progress.completed}/${progress.total ?? '?'}`) },
      )
      activeGpxExportRef.current = handle
      const result = await handle.promise
      const warnings: string[] = []
      if (result.skippedMissing) warnings.push(`${result.skippedMissing} points skipped (missing coordinates)`)
      if (result.skippedOutOfRange) warnings.push(`${result.skippedOutOfRange} points skipped (out of range)`)
      const blob = new Blob([result.xml], { type: 'application/gpx+xml;charset=utf-8' })
      saveBlob(blob, `${trackName || 'track'}.gpx`, 'gpx', result.pointCount, warnings)
    } catch (err) {
      if ((err as Error).name === 'AbortError') logger.warn('export', 'GPX export cancelled')
      else logger.error('export', `Export failed: ${(err as Error).message}`)
    } finally {
      activeGpxExportRef.current = null
      setGpxExportProgress(null)
    }
  }

  const download = () => {
    if (exportBlocked) return
    if (target === 'gpx' && shouldUseGpxExportWorker(dataset.points.length)) {
      void downloadGpxViaWorker()
      return
    }
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
      saveBlob(blob, fileName, target, preview.pointCount)
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

          {notionalCount > 0 && (
            <div className="export-warnings notional-export-gate">
              <p className="warn-line small">⚠ This dataset contains {notionalCount.toLocaleString()} notional (interpolated, not observed) point{notionalCount === 1 ? '' : 's'} from gap-fill smoothing.</p>
              <label className="chk"><input type="checkbox" checked={acknowledgedNotional} onChange={(e) => setAcknowledgedNotional(e.target.checked)} /> I understand this export includes notional, non-observed samples</label>
            </div>
          )}

          {gpxExportProgress ? (
            <div className="export-progress">
              <span className="muted small">{gpxExportProgress}</span>
              <button type="button" onClick={() => activeGpxExportRef.current?.cancel()}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="export-btn" onClick={download} disabled={dataset.points.length === 0 || exportBlocked} title={exportBlocked ? 'Acknowledge the notional-sample notice above to export' : undefined}>
              Export {preview.pointCount.toLocaleString()} points
            </button>
          )}
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
