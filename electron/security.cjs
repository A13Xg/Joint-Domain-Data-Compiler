const path = require('path')

const DEV_ORIGIN = 'http://localhost:5173'
const MAX_KML_LIBRARY_BYTES = 50 * 1024 * 1024
const MAX_DIAGNOSTIC_BUNDLE_BYTES = 5 * 1024 * 1024
const IPC_CHANNELS = Object.freeze({
  list: 'kml-library:list',
  save: 'kml-library:save',
  readText: 'kml-library:read-text',
  remove: 'kml-library:remove',
  reveal: 'kml-library:reveal',
  saveDiagnostics: 'diagnostics:save',
})

function isAllowedAppUrl(url, isDev) {
  if (typeof url !== 'string') return false
  if (isDev) return url === DEV_ORIGIN || url.startsWith(`${DEV_ORIGIN}/`)
  return url.startsWith('file://')
}

function safeLibraryName(name) {
  if (typeof name !== 'string') throw new Error('KML/KMZ filename must be a string')
  const base = path.basename(name).replace(/[^a-z0-9._ -]+/gi, '_').trim()
  if (!base) throw new Error('KML/KMZ filename is empty')
  const ext = path.extname(base).toLowerCase()
  if (ext !== '.kml' && ext !== '.kmz') throw new Error('Only .kml and .kmz files can be stored in the KML/KMZ library')
  return base
}

function resolveLibraryPath(directory, name) {
  const safe = safeLibraryName(name)
  const filePath = path.join(directory, safe)
  if (!filePath.startsWith(directory + path.sep)) throw new Error('KML/KMZ path escaped the library directory')
  return filePath
}

function ipcBytes(value) {
  let bytes
  if (value instanceof ArrayBuffer) bytes = new Uint8Array(value)
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  else throw new Error('KML/KMZ payload must be binary data')
  if (bytes.byteLength > MAX_KML_LIBRARY_BYTES) throw new Error('KML/KMZ file exceeds safety limit')
  return Buffer.from(bytes)
}

function diagnosticBundleText(value) {
  if (typeof value !== 'string') throw new Error('Diagnostic bundle must be text')
  if (Buffer.byteLength(value, 'utf8') > MAX_DIAGNOSTIC_BUNDLE_BYTES) {
    throw new Error('Diagnostic bundle exceeds safety limit')
  }
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Diagnostic bundle must be valid JSON')
  }
  if (!parsed || parsed.schemaVersion !== 1 || typeof parsed.generatedAt !== 'number') {
    throw new Error('Diagnostic bundle has an unsupported schema')
  }
  return value
}

module.exports = {
  DEV_ORIGIN,
  IPC_CHANNELS,
  MAX_DIAGNOSTIC_BUNDLE_BYTES,
  MAX_KML_LIBRARY_BYTES,
  diagnosticBundleText,
  ipcBytes,
  isAllowedAppUrl,
  resolveLibraryPath,
  safeLibraryName,
}
