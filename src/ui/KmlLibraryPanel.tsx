import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBytes } from '../core/format'
import {
  isDesktopKmlLibraryAvailable,
  listKmlLibrary,
  readKmlLibraryText,
  removeKmlLibraryFile,
  revealKmlLibrary,
  saveKmlLibraryFile,
} from '../desktop/kmlLibrary'
import type { KmlLibraryEntry } from '../types/desktop'

interface Props {
  onImportKmlText: (name: string, text: string, sourceBytes?: number) => void
  onAddMapOverlay?: (name: string, text: string, sourceBytes?: number) => void
}

export function KmlLibraryPanel({ onImportKmlText, onAddMapOverlay }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [entries, setEntries] = useState<KmlLibraryEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const available = isDesktopKmlLibraryAvailable()

  const refresh = useCallback(async () => {
    if (!available) return
    setBusy(true)
    setError(null)
    try {
      setEntries(await listKmlLibrary())
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }, [available])

  useEffect(() => {
    if (!available) return
    let cancelled = false
    listKmlLibrary()
      .then((loaded) => { if (!cancelled) setEntries(loaded) })
      .catch((cause: unknown) => { if (!cancelled) setError(message(cause)) })
    return () => { cancelled = true }
  }, [available])

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      let saved = 0
      for (const file of Array.from(files)) {
        if (!/\.km?l$/i.test(file.name)) throw new Error(`${file.name} is not a .kml or .kmz file`)
        await saveKmlLibraryFile(file)
        saved++
      }
      setStatus(`Saved ${saved} KML/KMZ file${saved === 1 ? '' : 's'} to the persistent library.`)
      setEntries(await listKmlLibrary())
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const importEntry = async (entry: KmlLibraryEntry) => {
    setBusy(true)
    setError(null)
    try {
      const result = await readKmlLibraryText(entry.name)
      onImportKmlText(entry.name, result.text, entry.bytes)
      setStatus(`Loaded ${entry.name}${entry.kind === 'kmz' ? ` (${result.entryName})` : ''} from the persistent library.`)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const addOverlay = async (entry: KmlLibraryEntry) => {
    if (!onAddMapOverlay) return
    setBusy(true); setError(null)
    try {
      const result = await readKmlLibraryText(entry.name)
      onAddMapOverlay(entry.name, result.text, entry.bytes)
      setStatus(`Added ${entry.name} as a visible map overlay.`)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  const removeEntry = async (entry: KmlLibraryEntry) => {
    setBusy(true)
    setError(null)
    try {
      await removeKmlLibraryFile(entry.name)
      setStatus(`Removed ${entry.name} from the KML/KMZ library.`)
      setEntries(await listKmlLibrary())
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!available) {
    return <div className="analysis-panel"><div className="panel-empty">Persistent KML/KMZ library storage is available in the Electron desktop app. In the browser build, import KML files directly from the Import tab.</div></div>
  }

  return (
    <div className="analysis-panel">
      <div className="analysis-toolbar">
        <button type="button" className="primary-action" disabled={busy} onClick={() => inputRef.current?.click()}>Upload to KML/KMZ library</button>
        <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh</button>
        <button type="button" disabled={busy} onClick={() => void revealKmlLibrary()}>Open folder</button>
        <span className="muted small">{entries.length.toLocaleString()} stored file{entries.length === 1 ? '' : 's'}</span>
        <input ref={inputRef} className="hidden-input" type="file" multiple accept=".kml,.kmz" onChange={(event) => { void uploadFiles(event.target.files); event.target.value = '' }} />
      </div>
      <p className="muted small">Files uploaded here are copied into the persistent <code>KML-KMZ</code> library folder. Selecting a KML or KMZ imports its first KML document as a normal dataset for map, table, 3D and export workflows; the stored source file remains available for later sessions.</p>
      {error && <div className="error-line">{error}</div>}
      {status && <div className="analysis-summary">{status}</div>}
      <div className="compact-table kml-library-table">
        <table>
          <thead><tr><th>file</th><th>kind</th><th>size</th><th>modified</th><th>actions</th></tr></thead>
          <tbody>
            {entries.length === 0 && <tr><td colSpan={5} className="muted">No KML/KMZ files stored yet.</td></tr>}
            {entries.map((entry) => (
              <tr key={entry.name}>
                <td className="left-cell">{entry.name}</td>
                <td>{entry.kind.toUpperCase()}</td>
                <td>{formatBytes(entry.bytes)}</td>
                <td>{new Date(entry.modifiedAt).toLocaleString()}</td>
                <td><button type="button" disabled={busy} onClick={() => void importEntry(entry)}>Import as data</button>{onAddMapOverlay && <> <button type="button" disabled={busy} onClick={() => void addOverlay(entry)}>Add overlay</button></>} <button type="button" disabled={busy} onClick={() => void removeEntry(entry)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
