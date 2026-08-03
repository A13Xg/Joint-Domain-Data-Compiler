const fs = require('fs')
const path = require('path')

function resolveSeedPath(directory, fileName) {
  const safeName = path.basename(fileName)
  if (safeName !== fileName) throw new Error('KML/KMZ seed filename escaped its directory')
  const normalizedDirectory = path.normalize(directory)
  const candidate = path.normalize(`${normalizedDirectory}${path.sep}${safeName}`)
  const relative = path.relative(normalizedDirectory, candidate)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('KML/KMZ seed filename escaped its directory')
  }
  return candidate
}

function seedKmlLibrary(sourceDirectory, targetDirectory) {
  fs.mkdirSync(targetDirectory, { recursive: true })
  if (!fs.existsSync(sourceDirectory)) return []
  const seeded = []
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.km?l$/i.test(entry.name)) continue
    const sourcePath = resolveSeedPath(sourceDirectory, entry.name)
    const targetPath = resolveSeedPath(targetDirectory, entry.name)
    if (fs.existsSync(targetPath)) continue
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL)
    seeded.push(entry.name)
  }
  return seeded.sort()
}

module.exports = { seedKmlLibrary }
