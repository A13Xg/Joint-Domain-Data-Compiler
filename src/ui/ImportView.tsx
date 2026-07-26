import { INPUT_FORMATS } from '../core/parsers'

export function ImportView({ dragActive, setDragActive, onFiles, openPicker }: { dragActive: boolean; setDragActive: (value: boolean) => void; onFiles: (files: FileList | null) => void; openPicker: () => void }) {
  return (
    <div className="import-view">
      <div className={`dropzone${dragActive ? ' drag' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragActive(true) }} onDragLeave={() => setDragActive(false)} onDrop={(event) => { event.preventDefault(); setDragActive(false); onFiles(event.dataTransfer.files) }} onClick={openPicker}>
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
