// P5 CTS mission workbench: roster identity, range georeference, and lossless
// binary export.
//
// This panel exists because a .msnP5 carries information the generic Dataset
// model has nowhere to put — a 50-slot participant roster where only a couple of
// slots ever report — and because its export is a byte patch of the source file
// rather than a serialization (docs/P5-MSN.md §8). Track colour is deliberately
// absent from the P5 format and is not faked here: it is the workspace's own
// per-dataset display setting, edited in place below so both live together.
import { useMemo, useState } from 'react'
import type { Dataset } from '../core/model'
import type { WorkspaceDisplay } from '../state/workspaceDisplay'
import { getP5Document } from '../core/p5/registry'
import { p5SlotCoverage, validateP5Document, type P5Document, type P5Participant, type P5SlotCoverage } from '../core/p5/document'
import { buildP5Export, readDatasetGeoReference, type P5RosterEdit } from '../core/exporters/p5'
import { P5_DEFAULT_GEOREFERENCE, type P5GeoReference } from '../core/parsers/p5'
import { logger } from '../core/logger'
import { errorMessage } from '../core/errors'

export interface P5PanelProps {
  datasets: Dataset[]
  display: WorkspaceDisplay
  onDisplayChange: (next: WorkspaceDisplay) => void
  /** Re-derive the tracks for one recording after a roster or georeference change. */
  onRebuild: (documentKey: string, georeference: P5GeoReference) => void
  onNotify: (message: string) => void
}

interface P5Group {
  key: string
  filename: string
  document: P5Document
  datasets: Dataset[]
}

/**
 * The georeference the loaded tracks were actually built with, or `null` if the
 * dataset's metadata is missing or fails validation. The distinction matters: a
 * null means export must stay disabled, because there is nothing to invert the
 * points through.
 */
function readStoredGeoReference(dataset: Dataset | undefined): P5GeoReference | null {
  return dataset ? readDatasetGeoReference(dataset) : null
}

/**
 * The three byte values seen in the one specimen this format was decoded from.
 * Deliberately unlabelled: nothing in the file maps a code to an airframe, so
 * naming them here would turn an inference into a claim. Any other byte is
 * still accepted and preserved.
 */
const OBSERVED_TYPE_CODES = [0x58, 0x5f, 0x62]

/** Only the fields the operator can change; the anchor is derived, not typed. */
const GEO_FIELDS = ['anchorLatDeg', 'anchorLonDeg', 'anchorHeightM', 'horizontalUnitMeters', 'verticalUnitMeters', 'axisOrder', 'originMode'] as const

function sameGeoReference(a: P5GeoReference, b: P5GeoReference): boolean {
  return GEO_FIELDS.every((field) => a[field] === b[field])
}

function formatDuration(subframes: number): string {
  const seconds = Math.round(subframes / 10)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

export function P5Panel({ datasets, display, onDisplayChange, onRebuild, onNotify }: P5PanelProps) {
  const groups = useMemo<P5Group[]>(() => {
    const byKey = new Map<string, P5Group>()
    for (const dataset of datasets) {
      const key = dataset.metadata?.meta?.p5DocumentKey
      if (!key) continue
      const document = getP5Document(key)
      if (!document) continue
      const existing = byKey.get(key)
      if (existing) existing.datasets.push(dataset)
      else {
        byKey.set(key, {
          key,
          filename: dataset.metadata?.meta?.p5SourceFilename ?? dataset.name,
          document,
          datasets: [dataset],
        })
      }
    }
    return [...byKey.values()]
  }, [datasets])

  if (groups.length === 0) {
    // A P5 dataset with no document behind it means the recording came in
    // through the generic import path (or was restored from a project archive),
    // which keeps the points but not the hundreds of megabytes of source bytes.
    // Roster editing and export both need those bytes, so say so plainly rather
    // than claiming nothing is loaded.
    const orphaned = datasets.some((dataset) => dataset.sourceFormat === 'p5')
    return (
      <div className="p5-panel pad">
        <h2>P5 mission</h2>
        {orphaned ? (
          <p className="muted">
            The P5 tracks in this workspace are not backed by their source recording in this session — a restored
            project keeps the points but not the original file. Re-import the <code>.msnP5</code> to edit its roster
            or export it again.
          </p>
        ) : (
          <p className="muted">
            No P5 recording is loaded. Import a <code>.msnP5</code> (drop its <code>.rpt</code> index alongside it and
            both are read together) to edit the participant roster, set the range georeference, and export the
            recording back out.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="p5-panel">
      {groups.map((group) => (
        <P5RecordingCard
          key={group.key}
          group={group}
          display={display}
          onDisplayChange={onDisplayChange}
          onRebuild={onRebuild}
          onNotify={onNotify}
        />
      ))}
    </div>
  )
}

function P5RecordingCard({
  group,
  display,
  onDisplayChange,
  onRebuild,
  onNotify,
}: { group: P5Group } & Omit<P5PanelProps, 'datasets'>) {
  const { document: doc } = group
  const [roster, setRoster] = useState<P5Participant[]>(() => doc.roster.map((p) => ({ ...p })))
  const [geo, setGeo] = useState<P5GeoReference>(() => readStoredGeoReference(group.datasets[0]) ?? P5_DEFAULT_GEOREFERENCE)
  const [showAllSlots, setShowAllSlots] = useState(false)
  // One pass over the whole recording, so it is computed on demand rather than
  // on every render of a panel the user may not have scrolled to.
  const [coverage, setCoverage] = useState<P5SlotCoverage[] | null>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const storedGeo = useMemo(() => readStoredGeoReference(group.datasets[0]), [group.datasets])
  // Export inverts each track through the georeference it was BUILT with. If the
  // form has moved on from that, exporting now would rewrite every sample under
  // a transform the points were never in, so the tracks must be rebuilt first.
  const geoDirty = storedGeo === null || !sameGeoReference(geo, storedGeo)
  // A cleared number input reads back as 0, and dividing by it on the way back
  // into frame units would write ±Infinity into the recording. Refuse to rebuild
  // on a scale that cannot be inverted rather than let it reach the file.
  const geoUsable =
    Number.isFinite(geo.horizontalUnitMeters) && geo.horizontalUnitMeters > 0 &&
    Number.isFinite(geo.verticalUnitMeters) && geo.verticalUnitMeters > 0 &&
    Number.isFinite(geo.anchorLatDeg) && Math.abs(geo.anchorLatDeg) <= 90 &&
    Number.isFinite(geo.anchorLonDeg) && Math.abs(geo.anchorLonDeg) <= 180 &&
    Number.isFinite(geo.anchorHeightM)

  // Keyed by slot rather than by array position: the two arrays happen to be
  // parallel today, and a positional match would quietly compare the wrong rows
  // if that ever stopped being true.
  const originalBySlot = useMemo(
    () => new Map(doc.roster.map((entry) => [entry.slot, entry])),
    [doc.roster],
  )

  const dirtySlots = useMemo(() => {
    const out = new Set<number>()
    for (const entry of roster) {
      const original = originalBySlot.get(entry.slot)
      if (!original) continue
      if (
        entry.aircraftId !== original.aircraftId ||
        entry.unit !== original.unit ||
        entry.callsign !== original.callsign ||
        entry.typeCode !== original.typeCode
      ) {
        out.add(entry.slot)
      }
    }
    return out
  }, [roster, originalBySlot])

  // Send only the fields that actually changed. Re-encoding an untouched field
  // would rewrite its whole fixed-width buffer, wiping anything the format keeps
  // after the first NUL — bytes this decode does not claim to understand.
  const rosterEdits = useMemo<P5RosterEdit[]>(
    () =>
      roster
        .filter((entry) => dirtySlots.has(entry.slot))
        .map((entry) => {
          const original = originalBySlot.get(entry.slot)
          const edit: P5RosterEdit = { slot: entry.slot }
          if (entry.aircraftId !== original?.aircraftId) edit.aircraftId = entry.aircraftId
          if (entry.unit !== original?.unit) edit.unit = entry.unit
          if (entry.callsign !== original?.callsign) edit.callsign = entry.callsign
          if (entry.typeCode !== original?.typeCode) edit.typeCode = entry.typeCode
          return edit
        }),
    [roster, dirtySlots, originalBySlot],
  )

  const visibleRoster = showAllSlots ? roster : roster.filter((entry) => doc.liveSlots.includes(entry.slot))

  const datasetForSlot = (slot: number) =>
    group.datasets.find((dataset) => (dataset.metadata?.meta?.p5Slots ?? '').split(',').includes(String(slot)))

  const updateSlot = (slot: number, patch: Partial<P5Participant>) => {
    setRoster((current) => current.map((entry) => (entry.slot === slot ? { ...entry, ...patch } : entry)))
  }

  /**
   * A P5 recording is hundreds of megabytes and every action here walks it
   * synchronously. Yielding a frame first lets React paint the disabled state,
   * so the UI shows it is working instead of appearing to hang.
   */
  const run = (describeFailure: string, work: () => void) => {
    setBusy(true)
    setTimeout(() => {
      try {
        work()
      } catch (error) {
        onNotify(`${describeFailure}: ${errorMessage(error)}`)
        logger.error('p5', `${describeFailure}: ${errorMessage(error)}`)
      } finally {
        setBusy(false)
      }
    }, 0)
  }

  /**
   * Point edits live in the datasets until something writes them into the
   * recording. A rebuild re-derives points straight from the bytes, so anything
   * not yet written would be silently thrown away — flush first, every time.
   */
  const flushAndRebuild = (nextGeo: P5GeoReference, rosterPatch: P5RosterEdit[] = []) => {
    buildP5Export(doc, { roster: rosterPatch, datasets: group.datasets })
    setRoster(doc.roster.map((p) => ({ ...p })))
    onRebuild(group.key, nextGeo)
  }

  const applyEdits = () =>
    run('Roster edit failed', () => {
      const count = rosterEdits.length
      flushAndRebuild(geo, rosterEdits)
      onNotify(`Applied ${count} roster change${count === 1 ? '' : 's'} to ${group.filename}.`)
    })

  // Rebuild re-reads the roster from the recording, so an edit typed but not yet
  // applied would vanish without trace. Carry it through instead of dropping it.
  const rebuildTracks = () =>
    run('Rebuild failed', () => {
      const carried = rosterEdits.length
      flushAndRebuild(geo, rosterEdits)
      onNotify(
        carried === 0
          ? `Rebuilt the tracks of ${group.filename} with the current georeference.`
          : `Rebuilt the tracks of ${group.filename}, applying ${carried} pending roster change${carried === 1 ? '' : 's'}.`,
      )
    })

  const revertRosterEdits = () => {
    setRoster(doc.roster.map((entry) => ({ ...entry })))
    onNotify('Discarded the unapplied roster changes.')
  }

  const showCoverage = () =>
    run('Coverage scan failed', () => {
      setCoverage(p5SlotCoverage(doc))
    })

  const runValidation = () =>
    run('Validation failed', () => {
      const report = validateP5Document(doc)
      setValidation(
        report.errors.length === 0
          ? `${report.blocks.toLocaleString()} blocks · ${report.subframes.toLocaleString()} subframes · ` +
              `${report.records.toLocaleString()} slot records (${report.liveRecords.toLocaleString()} live) · ` +
              `${report.clockAnomalies} clock anomal${report.clockAnomalies === 1 ? 'y' : 'ies'} · ` +
              `integrity words all match · structure clean`
          : `${report.errors.length} structural problem(s): ${report.errors.slice(0, 3).join(' | ')}`,
      )
    })

  const exportRecording = () =>
    run('P5 export failed', () => {
      const result = buildP5Export(doc, { roster: rosterEdits, datasets: group.datasets })
      setRoster(doc.roster.map((p) => ({ ...p })))
      // Rebuild after anything was written. Roster edits change the identity the
      // track labels are built from, and position writes leave the p5_x/p5_y/p5_z
      // channels showing the pre-export values — which the next export would then
      // read as a raw-channel edit.
      if (result.rosterWritten > 0 || result.positionsWritten > 0) onRebuild(group.key, geo)
      const stem = group.filename.replace(/\.msnp5$/i, '')
      saveBinary(result.msn, group.filename)
      saveBinary(result.rpt, `${stem}.rpt`)
      // The .teq is carried through untouched; an exported set has to be the same
      // set that was imported (docs/P5-MSN.md §8).
      if (result.teq) saveBinary(result.teq, `${stem}.teq`)
      for (const warning of result.warnings) logger.warn('export', warning)
      logger.success('export', `Exported ${group.filename}`, {
        positionsWritten: result.positionsWritten,
        rosterWritten: result.rosterWritten,
        bytes: result.msn.byteLength,
      })
      onNotify(
        result.positionsWritten === 0 && result.rosterWritten === 0
          ? `Exported ${group.filename} unchanged (byte-identical to the imported file).`
          : `Exported ${group.filename}: ${result.rosterWritten} roster slot(s), ${result.positionsWritten.toLocaleString()} sample(s) rewritten.`,
      )
    })

  return (
    <section className="p5-card">
      <header className="p5-card-header">
        <h2>{group.filename}</h2>
        <p className="muted small mono">
          {doc.header.dateLong.trim() || doc.header.dateShort} · {doc.blocks.length.toLocaleString()} blocks ·{' '}
          {doc.subframeCount.toLocaleString()} subframes @ 10 Hz · {formatDuration(doc.subframeCount)} ·{' '}
          {doc.liveSlots.length} of {doc.roster.length} slots instrumented
        </p>
        {doc.warnings.map((warning) => (
          <p key={warning} className="warn small">{warning}</p>
        ))}
      </header>

      <div className="p5-section">
        <h3>Range georeference</h3>
        <p className="muted small">
          A P5 recording stores positions in a range-local frame whose origin and unit scale are <strong>not in the
          file</strong>. These values are assumptions; the raw frame components stay available as the
          <code> p5_x</code>/<code>p5_y</code>/<code>p5_z</code> channels, so correcting them here and rebuilding
          re-places the tracks without re-importing. See <code>docs/P5-MSN.md</code> §6. Derived altitude carries
          whatever datum your anchor height is in, which is why these tracks report their altitude and time
          references as <em>unknown</em> rather than guessing.
        </p>
        {storedGeo === null && (
          <p className="warn small">
            These tracks carry no readable georeference — the metadata is missing or failed validation, which a
            hand-edited or older project file can cause. Set the values you want and rebuild; until then the points
            cannot be written back to the recording.
          </p>
        )}
        <label className="p5-origin-mode">
          Frame origin
          <select value={geo.originMode ?? 'first-sample'} onChange={(e) => setGeo({ ...geo, originMode: e.target.value as P5GeoReference['originMode'] })}>
            <option value="range-center">Range center — frame (0,0,0) is the surveyed center</option>
            <option value="first-sample">First live sample — no survey data needed</option>
          </select>
        </label>
        <p className="muted small">
          {geo.originMode === 'range-center'
            ? 'The coordinates below are the range center itself. This is what the format actually encodes, and the only mode that yields absolute positions.'
            : 'The coordinates below are where the recording’s first live sample is pinned. Useful for looking at the shape of a sortie, but every position is displaced by however far that sample was from the true range center.'}
        </p>
        <div className="p5-geo-grid">
          <label>{geo.originMode === 'range-center' ? 'Range center latitude' : 'Anchor latitude'}<input type="number" step="0.00001" value={geo.anchorLatDeg} onChange={(e) => setGeo({ ...geo, anchorLatDeg: Number(e.target.value) })} /></label>
          <label>{geo.originMode === 'range-center' ? 'Range center longitude' : 'Anchor longitude'}<input type="number" step="0.00001" value={geo.anchorLonDeg} onChange={(e) => setGeo({ ...geo, anchorLonDeg: Number(e.target.value) })} /></label>
          <label>{geo.originMode === 'range-center' ? 'Range center altitude (m)' : 'Anchor height (m, your datum)'}<input type="number" step="1" value={geo.anchorHeightM} onChange={(e) => setGeo({ ...geo, anchorHeightM: Number(e.target.value) })} /></label>
          <label>Horizontal m/unit<input type="number" step="0.01" min="0.0001" value={geo.horizontalUnitMeters} onChange={(e) => setGeo({ ...geo, horizontalUnitMeters: Number(e.target.value) })} /></label>
          <label>Vertical m/unit<input type="number" step="0.01" min="0.0001" value={geo.verticalUnitMeters} onChange={(e) => setGeo({ ...geo, verticalUnitMeters: Number(e.target.value) })} /></label>
          <label>Axis order
            <select value={geo.axisOrder} onChange={(e) => setGeo({ ...geo, axisOrder: e.target.value as P5GeoReference['axisOrder'] })}>
              <option value="x-east">X = East, Y = North</option>
              <option value="y-east">Y = East, X = North</option>
            </select>
          </label>
        </div>
        <button type="button" disabled={busy || !geoUsable} onClick={rebuildTracks}>
          Rebuild tracks{geoDirty ? ' (pending changes)' : ''}
        </button>
        {!geoUsable && (
          <p className="warn small">
            Both metres-per-unit scales must be greater than zero, and the anchor must be a real coordinate.
            A zero scale cannot be inverted, so points could not be written back.
          </p>
        )}
      </div>

      <div className="p5-section">
        <div className="p5-section-head">
          <h3>Participant roster</h3>
          <label className="small">
            <input type="checkbox" checked={showAllSlots} onChange={(e) => setShowAllSlots(e.target.checked)} /> show all {doc.roster.length} slots
          </label>
        </div>
        <table className="p5-roster">
          <thead>
            <tr><th>Slot</th><th>Colour</th><th>Callsign</th><th>Aircraft id</th><th>Unit</th><th>Type code</th><th>Data</th></tr>
          </thead>
          <tbody>
            {visibleRoster.map((entry) => {
              const dataset = datasetForSlot(entry.slot)
              const settings = dataset ? display[dataset.id] : undefined
              return (
                <tr key={entry.slot} className={dirtySlots.has(entry.slot) ? 'dirty' : undefined}>
                  <td className="mono">{entry.slot}</td>
                  <td>
                    {settings ? (
                      <input
                        type="color"
                        value={settings.color}
                        aria-label={`Track colour for slot ${entry.slot}`}
                        onChange={(e) => onDisplayChange({ ...display, [settings.id]: { ...settings, color: e.target.value } })}
                      />
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                  <td><input value={entry.callsign} maxLength={20} onChange={(e) => updateSlot(entry.slot, { callsign: e.target.value })} /></td>
                  <td><input value={entry.aircraftId} maxLength={8} onChange={(e) => updateSlot(entry.slot, { aircraftId: e.target.value })} /></td>
                  <td><input value={entry.unit} maxLength={8} onChange={(e) => updateSlot(entry.slot, { unit: e.target.value })} /></td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={255}
                      list="p5-type-codes"
                      value={entry.typeCode}
                      onChange={(e) => updateSlot(entry.slot, { typeCode: Number(e.target.value) })}
                    />
                  </td>
                  <td className="mono small">{doc.liveSlots.includes(entry.slot) ? 'live' : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="muted small">
          Type code is a single byte. Only three values have ever been observed (0x58, 0x5F, 0x62) and the mapping to
          airframes is inferred, not specified — see <code>docs/P5-MSN.md</code> §5.6. Unrecognized values are
          preserved as written.
        </p>
        <datalist id="p5-type-codes">
          {OBSERVED_TYPE_CODES.map((code) => (
            <option key={code} value={code}>{`0x${code.toString(16).toUpperCase()} (observed)`}</option>
          ))}
        </datalist>
        <div className="p5-actions">
          <button type="button" disabled={busy || rosterEdits.length === 0} onClick={applyEdits}>
            Apply {rosterEdits.length} roster change{rosterEdits.length === 1 ? '' : 's'}
          </button>
          <button type="button" disabled={busy || rosterEdits.length === 0} onClick={revertRosterEdits}>
            Discard changes
          </button>
        </div>
      </div>

      <div className="p5-section">
        <div className="p5-section-head">
          <h3>Where each track has data</h3>
          <button type="button" disabled={busy} onClick={showCoverage}>{coverage ? 'Rescan' : 'Scan coverage'}</button>
        </div>
        <p className="muted small">
          A P5 pod acquires late, drops out and re-acquires, and the recording marks every missing epoch
          individually. On a map those gaps are invisible — the track just draws straight across them. This is the
          one place they are visible. <strong>These are data-availability changes, not line-up changes:</strong> no
          mid-mission roster update appears anywhere in this format as decoded (<code>docs/P5-MSN.md</code> §10).
        </p>
        {coverage?.map((c) => {
          const participant = roster.find((entry) => entry.slot === c.slot)
          const pct = (100 * c.liveSubframes) / Math.max(1, doc.subframeCount)
          return (
            <div key={c.slot} className="p5-coverage">
              <div className="p5-coverage-label mono small">
                slot {c.slot} {participant?.callsign.trim()} {participant?.aircraftId.trim()}
                <span className="muted"> · {pct.toFixed(1)}% of the recording · {c.gaps.length} gap{c.gaps.length === 1 ? '' : 's'}</span>
              </div>
              <div
                className="p5-coverage-bar"
                role="img"
                aria-label={`Slot ${c.slot} carries data in ${pct.toFixed(1)} percent of the recording, with ${c.gaps.length} gaps`}
              >
                {Array.from(c.buckets).map((v, i) => (
                  <span key={i} className="p5-coverage-cell" style={{ opacity: v === 0 ? 1 : undefined, background: v === 0 ? 'var(--bg-2)' : `color-mix(in srgb, var(--accent) ${Math.round(v * 100)}%, var(--bg-2))` }} />
                ))}
              </div>
            </div>
          )
        })}
        {coverage && coverage.length === 0 && <p className="muted small">No slot in this recording carries data.</p>}
      </div>

      <div className="p5-section">
        <h3>Integrity and export</h3>
        <div className="p5-actions">
          <button type="button" disabled={busy} onClick={runValidation}>Validate structure &amp; integrity</button>
          <button type="button" disabled={busy || geoDirty} onClick={exportRecording}>Export .msnP5 + .rpt</button>
        </div>
        {geoDirty && (
          <p className="warn small">
            The georeference above has changed but the tracks still hold the previous one. Rebuild them first —
            exporting now would write every sample back through a transform it was never in.
          </p>
        )}
        {validation && <p className="small mono">{validation}</p>}
        <p className="muted small">
          Validation includes the per-subframe XOR word that covers all 4,400 payload bytes of every subframe — the
          format’s only whole-payload integrity check, so a single flipped byte anywhere is caught. Edits maintain it
          automatically.
        </p>
        <p className="muted small">
          Export patches the bytes of the file that was imported rather than regenerating it, so an export with no
          edits is byte-identical to the source. Point moves are written back through the georeference above; samples
          the recording marks as no-data are never promoted to live, and track colour does not round-trip because the
          format has no colour field.
        </p>
      </div>
    </section>
  )
}

function saveBinary(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
  // Deliberately NOT mirrored into the desktop file archive. That safety net
  // exists for files small enough to duplicate cheaply; a P5 recording would
  // cost a second full buffer in the renderer plus the same again over IPC,
  // every export, for a file the user is saving to disk anyway.
}
