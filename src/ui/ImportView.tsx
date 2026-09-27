import { INPUT_FORMATS } from '../core/parsers'

// The drop itself is handled window-wide (useWindowFileDrop), so a file dropped
// here is imported exactly once; this zone only reflects the drag state.
export function ImportView({ dragActive, openPicker }: { dragActive: boolean; openPicker: () => void }) {
  return (
    <div className="import-view">
      <div className={`dropzone${dragActive ? ' drag' : ''}`} role="button" tabIndex={0} aria-label="Drop files here, or press Enter to browse" onClick={openPicker} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPicker() } }}>
        <div className="dropzone-inner">
          <div className="dropzone-icon">⬇</div>
          <h2>Drop TSPI data here</h2>
          <p>or click to browse</p>
          <div className="dropzone-formats">{INPUT_FORMATS.map((format) => <span key={format.id} className="format-pill"><strong>{format.label}</strong><span>.{format.extensions[0]}</span></span>)}</div>
        </div>
      </div>
      <div className="import-notes"><h3>Conversion matrix</h3><p className="muted small">Any input format normalizes into a unified point model and can be exported to GPX, CSV, GeoJSON, KML, or the lossless GPB binary container. Coordinates accept decimal degrees, DMS, and comma decimals; timestamps auto-detect epoch s/ms/µs, Excel serial, and ISO-8601.</p></div>
    </div>
  )
}
