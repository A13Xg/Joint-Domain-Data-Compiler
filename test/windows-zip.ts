// scripts/package-zip.mjs: the "extract and run" Windows distribution.
// (Not named package-zip.ts: the runner bundles each harness to <name>.mjs, and
// the script runs its CLI when invoked as package-zip.mjs.)
//
// Round-trips a real directory through the writer and reads the archive back
// with an independent parser (and with `unzip -t` where installed), because a
// zip that only this writer can read is a release asset nobody can open.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { crc32, inflateRawSync } from 'node:zlib'
import { README_TEXT, windowsZipName, writeZip } from '../scripts/package-zip.mjs'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const root = resolve(process.cwd(), '.test-build', 'package-zip')
rmSync(root, { recursive: true, force: true })
const source = join(root, 'win-unpacked')
mkdirSync(join(source, 'resources', 'kml-seed'), { recursive: true })
mkdirSync(join(source, 'locales'), { recursive: true })
const files: Record<string, Buffer> = {
  'JointDomainDataCompiler.exe': Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200_000, 0x41)]),
  'resources/app.asar': randomBytes(50_000), // incompressible: must be stored, not grown
  'resources/kml-seed/Special Use Airspace.kml': Buffer.from('<kml>'.repeat(5000)),
  'locales/en-US.pak': Buffer.from('pak'),
  'empty.txt': Buffer.alloc(0),
  'ünïcödé name.txt': Buffer.from('utf-8 names survive'),
}
for (const [name, data] of Object.entries(files)) writeFileSync(join(source, name), data)
chmodSync(join(source, 'JointDomainDataCompiler.exe'), 0o755)

const zipPath = join(root, 'out', windowsZipName('Joint Domain Data Compiler', '1.2.3'))
const count = writeZip(source, zipPath, 'Joint Domain Data Compiler', [{ name: 'README.txt', data: README_TEXT }])
check('release asset is named like the installer and portable', zipPath.endsWith('Joint Domain Data Compiler-1.2.3-Windows-x64.zip'))

// --- independent reader: central directory -> local headers -> data ---
interface Entry { name: string; method: number; crc: number; size: number; compressed: number; offset: number; external: number; madeBy: number }
const zip = readFileSync(zipPath)
const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
check('archive ends with an end-of-central-directory record', eocd === zip.length - 22)
const total = zip.readUInt16LE(eocd + 10)
let cursor = zip.readUInt32LE(eocd + 16)
const entries: Entry[] = []
for (let i = 0; i < total; i++) {
  if (zip.readUInt32LE(cursor) !== 0x02014b50) break
  const nameLength = zip.readUInt16LE(cursor + 28)
  entries.push({
    madeBy: zip.readUInt16LE(cursor + 4),
    method: zip.readUInt16LE(cursor + 10),
    crc: zip.readUInt32LE(cursor + 16),
    compressed: zip.readUInt32LE(cursor + 20),
    size: zip.readUInt32LE(cursor + 24),
    external: zip.readUInt32LE(cursor + 38),
    offset: zip.readUInt32LE(cursor + 42),
    name: zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'),
  })
  cursor += 46 + nameLength + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32)
}
check('central directory lists every entry', entries.length === count && count === total, `${entries.length}/${count}`)
check('everything sits under ONE top-level folder', entries.every((entry) => entry.name.startsWith('Joint Domain Data Compiler/')))
check('the top-level folder itself is an entry', entries.some((entry) => entry.name === 'Joint Domain Data Compiler/'))

const contents = new Map<string, Buffer>()
let localHeadersAgree = true
for (const entry of entries) {
  if (zip.readUInt32LE(entry.offset) !== 0x04034b50) { localHeadersAgree = false; continue }
  const nameLength = zip.readUInt16LE(entry.offset + 26)
  const localName = zip.subarray(entry.offset + 30, entry.offset + 30 + nameLength).toString('utf8')
  if (localName !== entry.name) localHeadersAgree = false
  const start = entry.offset + 30 + nameLength + zip.readUInt16LE(entry.offset + 28)
  const body = zip.subarray(start, start + entry.compressed)
  const data = entry.method === 8 ? inflateRawSync(body) : Buffer.from(body)
  if (data.length !== entry.size || (data.length > 0 && crc32(data) >>> 0 !== entry.crc)) localHeadersAgree = false
  if (!entry.name.endsWith('/')) contents.set(entry.name.slice('Joint Domain Data Compiler/'.length), data)
}
check('local headers, sizes and CRCs agree with the central directory', localHeadersAgree)
for (const [name, data] of Object.entries(files)) {
  check(`round-trips ${name}`, contents.get(name)?.equals(data) === true)
}
check('the README is placed beside the executable', contents.get('README.txt')?.toString('utf8') === README_TEXT)
check('the README tells people to extract before running', /Extract All/.test(README_TEXT) && /cannot run from inside the \.zip/.test(README_TEXT))
const asar = entries.find((entry) => entry.name.endsWith('app.asar'))!
check('incompressible data is stored, never grown', asar.method === 0 && asar.compressed === asar.size)
const kml = entries.find((entry) => entry.name.endsWith('.kml'))!
check('compressible data is deflated', kml.method === 8 && kml.compressed < kml.size)
const exe = entries.find((entry) => entry.name.endsWith('.exe'))!
check('Unix permission bits are recorded for Unix extractors', exe.madeBy >> 8 === 3 && ((exe.external >>> 16) & 0o777) === 0o755)
const folder = entries.find((entry) => entry.name === 'Joint Domain Data Compiler/')!
check('directories carry the MS-DOS directory bit', (folder.external & 0x10) === 0x10)

let rejectedNestedRoot = false
try { writeZip(source, join(root, 'bad.zip'), 'a/b') } catch { rejectedNestedRoot = true }
check('a nested top-level name is rejected', rejectedNestedRoot)

const unzip = spawnSync('unzip', ['-tq', zipPath], { encoding: 'utf8' })
if (unzip.error) console.log('  [SKIP] unzip not installed; independent tool check skipped')
else check('unzip -t accepts the archive', unzip.status === 0, (unzip.stdout || unzip.stderr).trim())

rmSync(root, { recursive: true, force: true })
console.log(`\n${failures === 0 ? 'ALL PACKAGE ZIP CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
