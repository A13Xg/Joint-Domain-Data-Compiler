import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'

// Packs an unpacked desktop build into a plain .zip with ONE top-level folder.
// The Windows release lays it out so the only program in sight is the one to
// double-click:
//
//   Joint Domain Data Compiler/
//     Joint Domain Data Compiler.exe   <- the launcher (launcher/Launcher.cs)
//     README.txt
//     app/
//       JointDomainDataCompiler.exe    <- the Electron app it starts
//       resources/ locales/ ...
//
// The "extract it and run the exe" distribution. Unlike the portable .exe it
// never re-extracts ~300 MB into %TEMP% on every launch, and unlike the
// installer it needs no install step. electron-builder's own `zip` target was
// not used because on Windows and Linux it writes the app's files at the
// archive ROOT, so "Extract here" scatters ~80 files into whatever folder the
// zip happens to sit in.
//
// Written against node:zlib rather than a zip package or the platform's own
// tool so the identical code runs on the Windows release runner and on a Linux
// checkout, where test/package-zip.ts exercises it. No ZIP64: an Electron app is
// a few hundred MB, and this refuses anything that would need it.
//
// Usage: node scripts/package-zip.mjs <unpacked dir> <output.zip> [top-level folder name]

export const LAUNCHER_FILE_NAME = 'Joint Domain Data Compiler.exe'
const ZIP32_LIMIT = 0xffffffff
const MAX_ENTRIES = 0xffff

export const README_TEXT = [
  'Joint Domain Data Compiler',
  '==========================',
  '',
  'To run: double-click "Joint Domain Data Compiler.exe" in this folder.',
  '',
  'Keep everything in this folder together, including the "app" folder: the',
  'program is in there, and "Joint Domain Data Compiler.exe" only shows the',
  'splash and starts it. It cannot run from inside the .zip. Extract the whole',
  'zip first (right-click the .zip > Extract All...), then run it from the',
  'extracted folder. Any location you can write to works, including a USB drive.',
  '',
  'Settings, the overlay library and logs are kept in your user profile',
  '(%APPDATA%\\Joint Domain Data Compiler), not in this folder, so replacing the',
  'folder with a newer version keeps them. If a launch fails or shows nothing,',
  'the log at %APPDATA%\\Joint Domain Data Compiler\\logs\\main.log says why.',
  '',
  'Windows may warn that the app is from an unrecognised publisher the first',
  'time it runs; choose "More info" > "Run anyway" if you trust this download.',
  '',
].join('\r\n')

function dosDateTime(date) {
  // DOS timestamps start in 1980 and have two-second resolution.
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

/** Every file and directory under `root`, directories first, in a stable order. */
function walk(root) {
  const entries = []
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const stat = lstatSync(full)
      if (stat.isSymbolicLink()) throw new Error(`Refusing to archive a symbolic link: ${full}`)
      if (stat.isDirectory()) {
        entries.push({ full, stat, directory: true })
        visit(full)
      } else if (stat.isFile()) {
        entries.push({ full, stat, directory: false })
      }
    }
  }
  visit(root)
  return entries
}

/**
 * Writes `sourceDir` into `outFile` under `rootName/`, plus any `extraFiles`
 * ({ name, data }) placed inside that folder. With `appFolder`, everything
 * except the top-level files named in `topLevel` goes one level down, under
 * `rootName/<appFolder>/`. Returns the entry count.
 */
export function writeZip(sourceDir, outFile, rootName, extraFiles = [], { appFolder = null, topLevel = [] } = {}) {
  if (!rootName || /[\\/]/.test(rootName)) throw new Error('The top-level folder name must be a single path segment.')
  const source = resolve(sourceDir)
  if (!statSync(source).isDirectory()) throw new Error(`Not a directory: ${source}`)
  mkdirSync(dirname(resolve(outFile)), { recursive: true })

  if (appFolder !== null && (!appFolder || /[\\/]/.test(appFolder))) throw new Error('The app folder name must be a single path segment.')
  const placed = (relativePath) => (appFolder && !topLevel.includes(relativePath) ? `${rootName}/${appFolder}/${relativePath}` : `${rootName}/${relativePath}`)
  const items = [
    { name: `${rootName}/`, directory: true, mtime: new Date(), mode: 0o755 },
    ...(appFolder ? [{ name: `${rootName}/${appFolder}/`, directory: true, mtime: new Date(), mode: 0o755 }] : []),
    ...walk(source).map(({ full, stat, directory }) => ({
      name: `${placed(relative(source, full).split(sep).join('/'))}${directory ? '/' : ''}`,
      directory,
      full,
      mtime: stat.mtime,
      mode: stat.mode & 0o777,
    })),
    ...extraFiles.map(({ name, data }) => ({ name: `${rootName}/${name}`, directory: false, data: Buffer.from(data), mtime: new Date(), mode: 0o644 })),
  ]
  if (items.length > MAX_ENTRIES) throw new Error(`Too many entries for a zip without ZIP64: ${items.length}`)

  const fd = openSync(outFile, 'w')
  const central = []
  let offset = 0
  const write = (buffer) => {
    writeSync(fd, buffer)
    offset += buffer.length
  }

  try {
    for (const item of items) {
      const nameBytes = Buffer.from(item.name, 'utf8')
      const raw = item.directory ? Buffer.alloc(0) : (item.data ?? readFileSync(item.full))
      // Stored when deflate does not help (already-compressed .pak and .png
      // data), so the archive is never larger than its contents.
      const deflated = raw.length > 0 ? deflateRawSync(raw, { level: 9 }) : raw
      const method = deflated.length < raw.length ? 8 : 0
      const body = method === 8 ? deflated : raw
      if (raw.length > ZIP32_LIMIT || offset > ZIP32_LIMIT) throw new Error('Archive would need ZIP64; refusing.')
      const checksum = raw.length > 0 ? crc32(raw) : 0
      const { time, date } = dosDateTime(item.mtime)

      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0)
      local.writeUInt16LE(20, 4) // version needed: 2.0
      local.writeUInt16LE(0x0800, 6) // bit 11: names are UTF-8
      local.writeUInt16LE(method, 8)
      local.writeUInt16LE(time, 10)
      local.writeUInt16LE(date, 12)
      local.writeUInt32LE(checksum >>> 0, 14)
      local.writeUInt32LE(body.length, 18)
      local.writeUInt32LE(raw.length, 22)
      local.writeUInt16LE(nameBytes.length, 26)
      local.writeUInt16LE(0, 28)
      const localOffset = offset
      write(local)
      write(nameBytes)
      if (body.length > 0) write(body)

      const record = Buffer.alloc(46)
      record.writeUInt32LE(0x02014b50, 0)
      // "Made by" Unix, so Unix extractors restore the permission bits stored in
      // the high half of the external attributes (the Linux build's executable
      // bit). Windows extractors ignore both, and use the MS-DOS directory bit.
      record.writeUInt16LE((3 << 8) | 20, 4)
      record.writeUInt16LE(20, 6)
      record.writeUInt16LE(0x0800, 8)
      record.writeUInt16LE(method, 10)
      record.writeUInt16LE(time, 12)
      record.writeUInt16LE(date, 14)
      record.writeUInt32LE(checksum >>> 0, 16)
      record.writeUInt32LE(body.length, 20)
      record.writeUInt32LE(raw.length, 24)
      record.writeUInt16LE(nameBytes.length, 28)
      record.writeUInt16LE(0, 30)
      record.writeUInt16LE(0, 32)
      record.writeUInt16LE(0, 34)
      record.writeUInt16LE(0, 36)
      const unixMode = (item.directory ? 0o040000 : 0o100000) | item.mode
      record.writeUInt32LE(((unixMode << 16) | (item.directory ? 0x10 : 0)) >>> 0, 38)
      record.writeUInt32LE(localOffset, 42)
      central.push(Buffer.concat([record, nameBytes]))
    }

    const centralOffset = offset
    for (const record of central) write(record)
    const centralSize = offset - centralOffset
    if (centralOffset > ZIP32_LIMIT || centralSize > ZIP32_LIMIT) throw new Error('Archive would need ZIP64; refusing.')
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(central.length, 8)
    end.writeUInt16LE(central.length, 10)
    end.writeUInt32LE(centralSize, 12)
    end.writeUInt32LE(centralOffset, 16)
    write(end)
  } finally {
    closeSync(fd)
  }
  return items.length
}

/** The release asset name, matching the installer's and portable's pattern. */
export function windowsZipName(productName, version) {
  return `${productName}-${version}-Windows-x64.zip`
}

if (process.argv[1] && basename(process.argv[1]) === 'package-zip.mjs') {
  let [sourceDir, outFile, rootName] = process.argv.slice(2)
  let layout = {}
  if (sourceDir === '--windows') {
    // The release build: release/win-unpacked -> release/<name>-<version>-Windows-x64.zip
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    rootName = pkg.build.productName
    sourceDir = join('release', 'win-unpacked')
    outFile = join('release', windowsZipName(pkg.build.productName, pkg.version))
    // electron-builder copies the launcher in beside the app (build.win.extraFiles).
    if (!existsSync(join(sourceDir, LAUNCHER_FILE_NAME))) throw new Error(`${join(sourceDir, LAUNCHER_FILE_NAME)} is missing; run scripts/build-launcher.mjs before packaging.`)
    layout = { appFolder: 'app', topLevel: [LAUNCHER_FILE_NAME] }
  }
  rootName ??= 'Joint Domain Data Compiler'
  if (!sourceDir || !outFile) {
    console.error('Usage: node scripts/package-zip.mjs --windows | <unpacked dir> <output.zip> [top-level folder name]')
    process.exit(1)
  }
  const started = Date.now()
  const count = writeZip(sourceDir, outFile, rootName, [{ name: 'README.txt', data: README_TEXT }], layout)
  console.log(`Wrote ${outFile}: ${count} entries under "${rootName}/", ${(statSync(outFile).size / 1024 ** 2).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`)
}
