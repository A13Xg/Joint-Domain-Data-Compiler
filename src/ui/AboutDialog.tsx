// Release-info popup, opened from the small version button in the header.
//
// Deliberately static data rather than reading package.json's full dependency
// tree at runtime: the five libraries listed are the ones the product
// actually depends on (see package.json `dependencies`), and that list
// changes rarely enough that keeping it here, reviewed alongside the code
// that uses it, is more trustworthy than deriving it from a lockfile that
// also lists hundreds of transitive packages nobody asked to see.

import { useEffect, useRef } from 'react'
import { trapFocus } from './focusTrap'

interface LibraryCredit {
  name: string
  purpose: string
}

// Ordered by how central each one is to what JDDC does, not alphabetically.
const KEY_LIBRARIES: LibraryCredit[] = [
  { name: 'React', purpose: 'Application UI framework' },
  { name: 'React Leaflet', purpose: 'Interactive map rendering' },
  { name: 'Leaflet', purpose: 'Map tile and overlay engine' },
  { name: 'PapaParse', purpose: 'CSV/TSV parsing' },
  { name: 'Electron', purpose: 'Desktop packaging and native integration' },
]

interface Props {
  onClose: () => void
}

export function AboutDialog({ onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key === 'Tab') trapFocus(event, dialogRef.current)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="dialog about-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="about-dialog-title">
        <header className="repair-preview-head">
          <h3 id="about-dialog-title" className="dialog-title">Joint Domain Data Compiler</h3>
          <p className="dialog-message mono">v{__APP_VERSION__}</p>
        </header>

        <section className="about-section">
          <h4>Key libraries</h4>
          <ul className="about-library-list">
            {KEY_LIBRARIES.map((library) => (
              <li key={library.name}>
                <span className="about-library-name">{library.name}</span>
                <span className="muted small"> — {library.purpose}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="about-section">
          <p className="small">© {new Date().getFullYear()} A13Xg Industries. All rights reserved.</p>
        </section>

        <section className="about-section about-disclaimer" role="note">
          <p className="small">
            This program is for use with notional data and should never be used as a source of
            &quot;Truth Data&quot; or &quot;Evidentiary Data.&quot; Please use responsibly and with discretion.
          </p>
        </section>

        <div className="dialog-actions">
          <button type="button" className="primary" ref={closeRef} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
