// Node has global File/Blob (since v20) but no FileReader — a browser-only
// API that papaparse's File-based chunked streaming depends on. Without it,
// papaparse falls back to FileReaderSync, which Node also lacks, and throws.
// This polyfills just enough of the async FileReader contract (readAsText +
// onload/onerror) for papaparse's FileStreamer to work against a Node File in
// the test harness; production code always runs in a browser/Electron
// renderer, where the real FileReader is used.
class NodeFileReaderShim {
  onload: ((event: { target: { result: string } }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  error: unknown = null

  readAsText(blob: Blob): void {
    blob.text().then((text) => {
      this.onload?.({ target: { result: text } })
    }).catch((err) => {
      this.error = err
      this.onerror?.(err)
    })
  }
}

;(globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReaderShim
