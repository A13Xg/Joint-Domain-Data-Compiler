import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { formatBytes } from '../core/format'
import { parseKml } from '../core/parsers/kml'
import {
  isDesktopKmlLibraryAvailable,
  listKmlLibrary,
  readKmlLibraryText,
  removeKmlLibraryFile,
  reseedKmlLibrary,
  revealKmlLibrary,
  saveKmlLibraryFile,
} from '../desktop/kmlLibrary'
import type { KmlLibraryEntry } from '../types/desktop'
import {
  BUNDLED_KML_SEED_NAMES,
  MAX_OVERLAY_COUNT,
  MAX_OVERLAY_NAME_LENGTH,
  MAX_OVERLAY_SOURCE_KEY_LENGTH,
  checkOverlayCreation,
  reconcileMapOverlays,
  type MapOverlay,
  type MapOverlaySourceKind,
  type MapOverlayState,
  type OverlayCreationRejectionReason,
} from '../state/mapOverlays'

interface Props {
  /** Map-owned overlay state: which library files are shown, and how. */
  overlayState: MapOverlayState
  onOverlayStateChange: (next: MapOverlayState) => void
  /** Route a KML/KMZ library file through the ordinary parser import flow (a normal dataset, unrelated to overlay display). */
  onImportAsTrack: (name: string, text: string, sourceBytes?: number) => void
  /** Browser-only in-memory overlay library; Electron uses its persistent KML directory instead. */
  browserEntries: KmlLibraryEntry[]
  browserSources: Record<string, string>
  onBrowserFile: (entry: KmlLibraryEntry, text: string | null) => void
}

interface StatusLine { icon: string; text: string; tone: 'ok' | 'warn' | 'error' }

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function sourceKindFor(name: string, existing?: MapOverlaySourceKind): MapOverlaySourceKind {
  if (BUNDLED_KML_SEED_NAMES.has(name)) return 'bundled'
  return existing ?? 'library'
}

function badgeFor(kind: MapOverlaySourceKind): { icon: string; text: string } {
  if (kind === 'bundled') return { icon: '\u{1F4E6}', text: 'Bundled seed' }
  if (kind === 'project') return { icon: '\u{1F5C2}', text: 'Project' }
  return { icon: '\u{1F4C1}', text: 'Library' }
}

function statusFor(overlay: MapOverlay): StatusLine {
  if (overlay.status === 'missing') return { icon: '⚠', text: 'Missing source file', tone: 'warn' }
  if (overlay.status === 'error') return { icon: '✕', text: 'Failed to load', tone: 'error' }
  return { icon: '✓', text: 'Ready', tone: 'ok' }
}

function overlayCreationRejectionMessage(reason: OverlayCreationRejectionReason, name: string): string {
  if (reason === 'name-too-long') return `"${name}" is too long to show as a map overlay (overlay names are limited to ${MAX_OVERLAY_NAME_LENGTH} characters). Rename the file and re-upload it.`
  if (reason === 'source-key-too-long') return `"${name}" exceeds the ${MAX_OVERLAY_SOURCE_KEY_LENGTH}-character source filename limit and cannot be shown as a map overlay.`
  return `Cannot show "${name}" on the map: the ${MAX_OVERLAY_COUNT}-overlay limit has been reached. Remove another overlay first.`
}

function nextZIndex(overlays: MapOverlay[]): number {
  return overlays.reduce((max, overlay) => Math.max(max, overlay.zIndex), -1) + 1
}

/**
 * Map-local overlay manager (Task 1.4). Owns the persistent KML/KMZ library
 * (upload/refresh/remove/reset-bundled-seed) and the `MapOverlay` display
 * state (visibility/opacity/z-order/source badges). Deliberately does not
 * touch dataset import — "Import as track" delegates to the ordinary parser
 * flow via `onImportAsTrack` so overlay display and dataset creation never
 * conflate (product decisions 2 and 3).
 */
export function MapOverlayPanel({ overlayState, onOverlayStateChange, onImportAsTrack, browserEntries, browserSources, onBrowserFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<KmlLibraryEntry[]>(browserEntries)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedLibraryName, setSelectedLibraryName] = useState('')
  const available = isDesktopKmlLibraryAvailable()

  // Keep the latest props on refs so the mount-only effect below and the
  // stable `refresh`/`updateOverlays` callbacks never read stale values,
  // without writing to a ref during render (refs are synced in an effect).
  const overlayStateRef = useRef(overlayState)
  const onOverlayStateChangeRef = useRef(onOverlayStateChange)
  useEffect(() => {
    overlayStateRef.current = overlayState
    onOverlayStateChangeRef.current = onOverlayStateChange
  })

  // Shared list+reconcile logic with no busy-state management of its own, so
  // callers that need to bracket a *sequence* of async operations (e.g.
  // `resetBundledSeed`, which reseeds and then reloads) can wrap the whole
  // sequence in a single busy toggle instead of nesting one from `refresh`.
  const loadLibrary = useCallback(async () => {
    const loaded = available ? await listKmlLibrary() : browserEntries
    setEntries(loaded)
    const availableKeys = new Set(loaded.map((entry) => entry.name))
    const reconciled = reconcileMapOverlays(overlayStateRef.current, availableKeys)
    if (reconciled !== overlayStateRef.current) onOverlayStateChangeRef.current(reconciled)
    return loaded
  }, [available, browserEntries])

  const refresh = useCallback(async () => {
    if (!available) {
      setEntries(browserEntries)
      return browserEntries
    }
    setBusy(true)
    setError(null)
    try {
      return await loadLibrary()
    } catch (cause) {
      setError(message(cause))
      return null
    } finally {
      setBusy(false)
    }
  }, [available, browserEntries, loadLibrary])

  // Mount-time load: fetch the persistent library and reconcile overlay
  // status without calling setState synchronously in the effect body itself
  // (only inside the async continuation), and without depending on the
  // `refresh` identity so this runs once rather than on every prop change.
  useEffect(() => {
    let cancelled = false
    if (!available) {
      return () => { cancelled = true }
    }
    listKmlLibrary()
      .then((loaded) => {
        if (cancelled) return
        setEntries(loaded)
        const availableKeys = new Set(loaded.map((entry) => entry.name))
        const reconciled = reconcileMapOverlays(overlayStateRef.current, availableKeys)
        if (reconciled !== overlayStateRef.current) onOverlayStateChangeRef.current(reconciled)
      })
      .catch((cause: unknown) => { if (!cancelled) setError(message(cause)) })
    return () => { cancelled = true }
  }, [available, browserEntries])

  const updateOverlays = useCallback((updater: (overlays: MapOverlay[]) => MapOverlay[]) => {
    onOverlayStateChangeRef.current({ overlays: updater(overlayStateRef.current.overlays) })
  }, [])

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      let saved = 0
      for (const file of Array.from(files)) {
        if (!/\.km?l$/i.test(file.name)) throw new Error(`${file.name} is not a .kml or .kmz file`)
        if (available) {
          await saveKmlLibraryFile(file)
        } else {
          if (/\.kmz$/i.test(file.name)) throw new Error('KMZ overlay extraction requires the Electron desktop build; upload the contained KML file in the browser.')
          const text = await file.text()
          const parsed = parseKml(text)
          if (parsed.points.length === 0) throw new Error(`${file.name} does not contain any usable coordinates`)
          onBrowserFile({ name: file.name, bytes: file.size, modifiedAt: Date.now(), kind: 'kml' }, text)
        }
        saved++
      }
      setStatus(`Saved ${saved} file${saved === 1 ? '' : 's'} to the KML/KMZ library. Use "Show on map" to display one as an overlay.`)
      await refresh()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  // Explicitly reseeds the persistent library via a dedicated IPC call, then
  // reloads the entries in the same busy-state bracket (a single setBusy
  // true/false pair rather than nesting `refresh`'s own toggle inside this
  // one, which previously flipped `busy` off and back on within a single
  // click).
  const resetBundledSeed = async () => {
    if (!available) return
    setBusy(true)
    setError(null)
    try {
      const seeded = await reseedKmlLibrary()
      await loadLibrary()
      setStatus(seeded.length > 0
        ? `Restored ${seeded.length} bundled seed file${seeded.length === 1 ? '' : 's'} into the library folder (existing files were not overwritten).`
        : 'Bundled seed files are already present in the library folder (existing files were not overwritten).')
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const showOnMap = (entry: KmlLibraryEntry) => {
    const id = `overlay:${entry.name}`
    const existingOverlay = overlayStateRef.current.overlays.find((overlay) => overlay.id === id)
    // Preserve a non-bundled overlay's existing sourceKind (e.g. 'project')
    // across a re-show rather than recomputing it fresh each time, so only
    // a genuinely bundled-seed name ever forces the 'bundled' badge.
    const sourceKind = sourceKindFor(entry.name, existingOverlay?.sourceKind)
    // Enforce, at creation time, the same caps `mapOverlays.ts` applies at
    // project load time (`normalizeMapOverlayState`/`normalizeOverlay`).
    // Without this, an overlay minted from an over-long library filename, or
    // added past the overlay-count cap, would be accepted into in-session
    // state fine but then fail `validateProjectManifest`/`validateView` on
    // the next save/load, discarding overlay state or rejecting the whole
    // project file.
    const overlayCheck = checkOverlayCreation(overlayStateRef.current.overlays, id, entry.name, entry.name)
    if (!overlayCheck.ok) {
      setError(overlayCreationRejectionMessage(overlayCheck.reason!, entry.name))
      return
    }
    setError(null)
    updateOverlays((overlays) => {
      if (overlays.some((overlay) => overlay.id === id)) {
        return overlays.map((overlay) => overlay.id === id ? { ...overlay, sourceKind, visible: true, status: 'ready' } : overlay)
      }
      return [...overlays, {
        id,
        sourceKind,
        sourceKey: entry.name,
        name: entry.name,
        visible: true,
        opacity: 0.8,
        zIndex: nextZIndex(overlays),
        status: 'ready',
      }]
    })
    setStatus(`${entry.name} is now a visible map overlay.`)
  }

  const importAsTrack = async (entry: KmlLibraryEntry) => {
    setBusy(true)
    setError(null)
    try {
      const result = available ? await readKmlLibraryText(entry.name) : { text: browserSources[entry.name] ?? '', entryName: entry.name }
      if (!result.text) throw new Error(`No source content is available for ${entry.name}`)
      onImportAsTrack(entry.name, result.text, entry.bytes)
      setStatus(`Imported ${entry.name}${entry.kind === 'kmz' ? ` (${result.entryName})` : ''} as a normal dataset via Import.`)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const removeFile = async (entry: KmlLibraryEntry) => {
    if (!window.confirm(`Delete "${entry.name}" from the persistent KML/KMZ library? This cannot be undone; any map overlay showing it will be removed too.`)) return
    setBusy(true)
    setError(null)
    try {
      if (available) await removeKmlLibraryFile(entry.name)
      else onBrowserFile(entry, null)
      updateOverlays((overlays) => overlays.filter((overlay) => overlay.sourceKey !== entry.name))
      setStatus(`Removed ${entry.name} from the KML/KMZ library.`)
      await refresh()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const toggleVisible = (overlay: MapOverlay) => {
    updateOverlays((overlays) => overlays.map((item) => item.id === overlay.id ? { ...item, visible: !item.visible } : item))
  }

  const setOpacity = (overlay: MapOverlay, opacity: number) => {
    updateOverlays((overlays) => overlays.map((item) => item.id === overlay.id ? { ...item, opacity } : item))
  }

  const removeOverlay = (overlay: MapOverlay) => {
    updateOverlays((overlays) => overlays.filter((item) => item.id !== overlay.id))
  }

  const move = (overlay: MapOverlay, direction: -1 | 1) => {
    updateOverlays((overlays) => {
      const ordered = [...overlays].sort((a, b) => a.zIndex - b.zIndex)
      const index = ordered.findIndex((item) => item.id === overlay.id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= ordered.length) return overlays
      const swapped = [...ordered]
      const temp = swapped[index]!
      swapped[index] = swapped[target]!
      swapped[target] = temp
      const reindexed = swapped.map((item, position) => ({ ...item, zIndex: position }))
      return overlays.map((item) => reindexed.find((next) => next.id === item.id) ?? item)
    })
  }

  const sortedOverlays = [...overlayState.overlays].sort((a, b) => a.zIndex - b.zIndex)
  const visibleEntries = available ? entries : browserEntries

  return (
    <div className="map-overlay-drawer">
      <button type="button" className="map-overlay-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        Overlays{overlayState.overlays.length > 0 && ` (${overlayState.overlays.filter((overlay) => overlay.visible).length}/${overlayState.overlays.length})`}
      </button>
      {open && (
        <div id={panelId} className="map-overlay-panel analysis-panel" role="region" aria-label="Map overlay manager">
          <>
              <div className="analysis-toolbar">
                <label className="map-overlay-picker">overlay library<select value={selectedLibraryName} onChange={(event) => setSelectedLibraryName(event.target.value)}><option value="">Select a KML/KMZ overlay…</option>{visibleEntries.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}</select></label>
                <button type="button" className="primary-action" disabled={busy || !selectedLibraryName} onClick={() => { const entry = visibleEntries.find((candidate) => candidate.name === selectedLibraryName); if (entry) showOnMap(entry) }}>Show selected</button>
                <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>+ Import overlay</button>
                <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh</button>
                {available && <button type="button" disabled={busy} onClick={() => void resetBundledSeed()}>Reset bundled seed</button>}
                {available && <button type="button" disabled={busy} onClick={() => void revealKmlLibrary()}>Open folder</button>}
                <span className="muted small">{visibleEntries.length.toLocaleString()} stored file{visibleEntries.length === 1 ? '' : 's'}</span>
                <input ref={inputRef} className="hidden-input" type="file" multiple accept=".kml,.kmz" onChange={(event) => { void uploadFiles(event.target.files); event.target.value = '' }} />
              </div>
              {error && <div className="error-line" role="alert"><span aria-hidden="true">{'✕'}</span> {error}</div>}
              {!error && status && <div className="analysis-summary" role="status"><span aria-hidden="true">{'✓'}</span> {status}</div>}

              <h4 className="map-overlay-heading">On the map</h4>
              {sortedOverlays.length === 0 && <div className="panel-empty">No overlays shown yet. Use "Show on map" below on a stored file.</div>}
              {sortedOverlays.length > 0 && (
                <ul className="map-overlay-list">
                  {sortedOverlays.map((overlay) => {
                    const badge = badgeFor(overlay.sourceKind)
                    const statusLine = statusFor(overlay)
                    return (
                      <li key={overlay.id} className={`map-overlay-row map-overlay-status-${statusLine.tone}`}>
                        <label className="map-overlay-visible">
                          <input
                            type="checkbox"
                            checked={overlay.visible}
                            aria-label={`Toggle visibility of overlay ${overlay.name}`}
                            onChange={() => toggleVisible(overlay)}
                          />
                          <span>{overlay.name}</span>
                        </label>
                        <span className="badge map-overlay-badge" title={badge.text}><span aria-hidden="true">{badge.icon}</span> {badge.text}</span>
                        <span className={`map-overlay-status-line map-overlay-status-${statusLine.tone}`}>
                          <span aria-hidden="true">{statusLine.icon}</span> {statusLine.text}
                        </span>
                        <label className="map-overlay-opacity">
                          opacity
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={overlay.opacity}
                            aria-label={`Opacity for overlay ${overlay.name}`}
                            onChange={(event) => setOpacity(overlay, Number(event.target.value))}
                          />
                          <span className="mono small">{Math.round(overlay.opacity * 100)}%</span>
                        </label>
                        <span className="map-overlay-order">
                          <button type="button" aria-label={`Move overlay ${overlay.name} up`} onClick={() => move(overlay, -1)}>{'▲'}</button>
                          <button type="button" aria-label={`Move overlay ${overlay.name} down`} onClick={() => move(overlay, 1)}>{'▼'}</button>
                        </span>
                        <button type="button" onClick={() => removeOverlay(overlay)}>Remove from map</button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <h4 className="map-overlay-heading">KML/KMZ library</h4>
              <p className="muted small">Files uploaded here are separate map overlays, not TSPI datasets. Electron stores them in the bundled <code>KML-KMZ</code> directory; the browser keeps uploaded KML overlays for the current session. "Import as track" remains a separate action.</p>
              <div className="compact-table kml-library-table">
                <table>
                  <thead><tr><th>file</th><th>kind</th><th>size</th><th>modified</th><th>actions</th></tr></thead>
                  <tbody>
                    {visibleEntries.length === 0 && <tr><td colSpan={5} className="muted">No KML/KMZ files stored yet.</td></tr>}
                    {visibleEntries.map((entry) => (
                      <tr key={entry.name}>
                        <td className="left-cell">{entry.name}{BUNDLED_KML_SEED_NAMES.has(entry.name) && <span className="badge map-overlay-badge" title="Bundled seed"> <span aria-hidden="true">{'\u{1F4E6}'}</span> bundled</span>}</td>
                        <td>{entry.kind.toUpperCase()}</td>
                        <td>{formatBytes(entry.bytes)}</td>
                        <td>{new Date(entry.modifiedAt).toLocaleString()}</td>
                        <td>
                          <button type="button" disabled={busy} onClick={() => showOnMap(entry)}>Show on map</button>{' '}
                          <button type="button" disabled={busy} onClick={() => void importAsTrack(entry)}>Import as track</button>{' '}
                          <button type="button" disabled={busy} onClick={() => void removeFile(entry)}>Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          </>
        </div>
      )}
    </div>
  )
}
