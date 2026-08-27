import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Electron validates every byte it reads out of app.asar when the
// EnableEmbeddedAsarIntegrityValidation fuse is on: the archive header against a
// hash embedded in the executable (Windows) or Info.plist (macOS), and each file
// against the `integrity` block recorded for it in that header. A mismatch is not
// an error dialog -- lib/node/asar-fs-wrapper.ts prints one line to a console no
// packaged user ever sees and calls process.exit(1). The app never opens a window
// and never appears in the task manager.
//
// That is exactly how @electron/asar 4.1.2-4.3.0 shipped a broken 0.1.1: its
// small-file fast path hashed the source file from disk instead of the bytes
// electron-builder actually streams into the archive, so every package.json
// electron-builder rewrites during packing (the app's own, plus one per runtime
// dependency) carried the hash of its pre-rewrite content. This script re-runs
// Electron's own check at build time so a packaging regression fails the release
// instead of shipping a program that silently refuses to start.

const explicit = process.argv[2]
const archives = explicit ? [resolve(explicit)] : discoverArchives()

if (archives.length === 0) {
  console.error('No packaged app.asar found under release/. Package the app before verifying it.')
  process.exit(1)
}

let failures = 0
for (const archive of archives) {
  try {
    failures += verifyArchive(archive)
  } catch (error) {
    // A corrupt archive throws while its header is being read, long before a
    // single file can be hashed. Report that as the finding it is: letting the
    // raw error escape dumps the entire header at whoever reads the build log.
    console.error(`  ${archive}: unreadable -- ${error.message.split(`\n`)[0]}`)
    failures++
  }
}

if (failures > 0) {
  console.error(`\nASAR integrity verification failed with ${failures} problem(s). The packaged app would exit at launch.`)
  process.exit(1)
}
console.log(`ASAR integrity verified across ${archives.length} archive(s).`)

// electron-builder writes resources/app.asar for Windows and Linux, and
// Contents/Resources/app.asar inside the .app bundle for macOS.
function discoverArchives() {
  if (!existsSync('release')) return []
  const found = []
  for (const entry of readdirSync('release', { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const root = join('release', entry.name)
    const candidates = [join(root, 'resources', 'app.asar')]
    for (const inner of readdirSync(root, { withFileTypes: true })) {
      if (inner.isDirectory() && inner.name.endsWith('.app')) {
        candidates.push(join(root, inner.name, 'Contents', 'Resources', 'app.asar'))
      }
    }
    for (const candidate of candidates) {
      if (existsSync(candidate)) found.push(resolve(candidate))
    }
  }
  return found
}

function verifyArchive(archive) {
  const { header, headerHash, contentBase } = readHeader(archive)
  let problems = 0

  const embedded = embeddedHeaderHash(archive)
  if (embedded == null) {
    console.log(`  header: no embedded hash found next to ${archive} (expected on Linux, which has no equivalent)`)
  } else if (embedded !== headerHash) {
    console.error(`  header: MISMATCH -- archive hashes to ${headerHash}, executable expects ${embedded}`)
    problems++
  } else {
    console.log(`  header: ${headerHash} matches the hash embedded in the executable`)
  }

  const fd = openSync(archive, 'r')
  let checked = 0
  try {
    for (const { path, node } of walk(header)) {
      const bytes = readEntry(fd, archive, contentBase, path, node)
      if (bytes == null) continue
      checked++
      if (!node.integrity) {
        console.error(`  ${path}: no integrity block recorded`)
        problems++
        continue
      }
      const actual = createHash(node.integrity.algorithm).update(bytes).digest('hex')
      if (actual !== node.integrity.hash) {
        console.error(`  ${path}: MISMATCH -- stored bytes hash to ${actual}, header records ${node.integrity.hash}`)
        problems++
        continue
      }
      problems += verifyBlocks(path, bytes, node.integrity)
    }
  } finally {
    closeSync(fd)
  }

  console.log(`${archive}: checked ${checked} file(s), ${problems} problem(s)`)
  return problems
}

// Electron re-hashes each `blockSize` chunk separately for streamed reads, so a
// correct whole-file hash with wrong blocks still aborts the app mid-read.
function verifyBlocks(path, bytes, integrity) {
  if (!Array.isArray(integrity.blocks) || !integrity.blockSize) return 0
  const expectedCount = Math.max(1, Math.ceil(bytes.length / integrity.blockSize))
  if (integrity.blocks.length !== expectedCount) {
    console.error(`  ${path}: records ${integrity.blocks.length} integrity block(s) for ${expectedCount} block(s) of content`)
    return 1
  }
  for (let index = 0; index < integrity.blocks.length; index++) {
    const chunk = bytes.subarray(index * integrity.blockSize, (index + 1) * integrity.blockSize)
    const actual = createHash(integrity.algorithm).update(chunk).digest('hex')
    if (actual !== integrity.blocks[index]) {
      console.error(`  ${path}: block ${index} MISMATCH -- ${actual} vs recorded ${integrity.blocks[index]}`)
      return 1
    }
  }
  return 0
}

// A pickled uint32 length, then a pickled string holding the JSON header. Both
// the header hash and every file offset are measured from the end of that block.
function readHeader(archive) {
  const fd = openSync(archive, 'r')
  try {
    const sizeBuffer = Buffer.allocUnsafe(8)
    if (readSync(fd, sizeBuffer, 0, 8, 0) !== 8) throw new Error(`${archive} is truncated: no header size`)
    const pickledSize = sizeBuffer.readUInt32LE(4)
    const headerBuffer = Buffer.allocUnsafe(pickledSize)
    if (readSync(fd, headerBuffer, 0, pickledSize, 8) !== pickledSize) throw new Error(`${archive} is truncated: no header`)
    // A pickle opens with its own uint32 payload size, so the string's uint32
    // length sits at offset 4 and its UTF-8 payload at offset 8.
    const headerLength = headerBuffer.readUInt32LE(4)
    const header = headerBuffer.subarray(8, 8 + headerLength).toString('utf8')
    let parsed
    try {
      parsed = JSON.parse(header)
    } catch (error) {
      throw new Error(`header is not valid JSON (${error.message.slice(0, 80)})`, { cause: error })
    }
    return {
      header: parsed,
      headerHash: createHash('sha256').update(header).digest('hex'),
      contentBase: 8 + pickledSize,
    }
  } finally {
    closeSync(fd)
  }
}

function* walk(node, prefix = '') {
  for (const [name, child] of Object.entries(node.files ?? {})) {
    const path = `${prefix}/${name}`
    if (child.files) yield* walk(child, path)
    else yield { path, node: child }
  }
}

// Unpacked entries live beside the archive in app.asar.unpacked; symlinks and
// directories carry no content to hash.
function readEntry(fd, archive, contentBase, path, node) {
  if (typeof node.link === 'string') return null
  if (node.unpacked) {
    const external = join(`${archive}.unpacked`, path)
    return existsSync(external) && statSync(external).isFile() ? readFileSync(external) : null
  }
  if (typeof node.offset === 'undefined') return null
  const size = Number(node.size)
  const bytes = Buffer.allocUnsafe(size)
  if (size > 0) readSync(fd, bytes, 0, size, contentBase + Number(node.offset))
  return bytes
}

// electron-builder stores the expected header hash as a UTF-8 JSON blob: in an
// ELECTRONASAR resource inside the Windows .exe, and under ElectronAsarIntegrity
// in the macOS Info.plist. Both are scanned as raw bytes rather than parsed, so
// this stays free of PE and plist dependencies. Linux embeds nothing.
function embeddedHeaderHash(archive) {
  for (const carrier of integrityCarriers(archive)) {
    if (!existsSync(carrier)) continue
    const haystack = readFileSync(carrier).toString('latin1')
    const json = haystack.match(/"file":"resources[\\/]+app\.asar","alg":"SHA256","value":"([0-9a-f]{64})"/)
    if (json) return json[1]
    const plist = haystack.match(/<key>Resources\/app\.asar<\/key>[\s\S]{0,400}?<key>hash<\/key>\s*<string>([0-9a-f]{64})<\/string>/)
    if (plist) return plist[1]
  }
  return null
}

function integrityCarriers(archive) {
  const resources = resolve(archive, '..')
  const macApp = resolve(resources, '..', '..')
  const carriers = [join(macApp, 'Contents', 'Info.plist'), resolve(resources, '..', 'Info.plist')]
  const appOut = resolve(resources, '..')
  if (existsSync(appOut)) {
    for (const entry of readdirSync(appOut, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) carriers.push(join(appOut, entry.name))
    }
  }
  return carriers
}
