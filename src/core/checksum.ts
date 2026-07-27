// SHA-256 content checksums for imported source files, using the standard Web
// Crypto API available in browsers, Electron renderers, and Node 20+ — no
// third-party hashing dependency required.
export async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
