const fs = require('fs')
const path = require('path')

function seedKmlLibrary(sourceDirectory, targetDirectory) {
  fs.mkdirSync(targetDirectory, { recursive: true })
  if (!fs.existsSync(sourceDirectory)) return []
  const seeded = []
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.km?l$/i.test(entry.name)) continue
    const sourcePath = path.join(sourceDirectory, entry.name)
    const targetPath = path.join(targetDirectory, entry.name)
    if (fs.existsSync(targetPath)) continue
    fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL)
    seeded.push(entry.name)
  }
  return seeded.sort()
}

module.exports = { seedKmlLibrary }
