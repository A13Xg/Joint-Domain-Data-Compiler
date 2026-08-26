const fs = require('fs')
const path = require('path')
const https = require('https')

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

// Fetch KML from remote GitHub repo (non-blocking, with timeout and error handling)
async function fetchKmlFromRemote(targetPath, remoteUrl, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
      resolve({ success: false, error: 'Fetch timeout' })
    }, timeoutMs)

    https
      .get(remoteUrl, { timeout: timeoutMs }, (response) => {
        clearTimeout(timeoutHandle)

        if (response.statusCode !== 200) {
          resolve({ success: false, error: `HTTP ${response.statusCode}` })
          response.resume() // Drain response to free connection
          return
        }

        const chunks = []
        let totalSize = 0
        const maxSize = 50 * 1024 * 1024 // 50 MB safety limit

        response.on('data', (chunk) => {
          totalSize += chunk.length
          if (totalSize > maxSize) {
            response.destroy()
            resolve({ success: false, error: 'File too large' })
            return
          }
          chunks.push(chunk)
        })

        response.on('end', () => {
          try {
            const content = Buffer.concat(chunks)
            fs.mkdirSync(path.dirname(targetPath), { recursive: true })
            fs.writeFileSync(targetPath, content)
            resolve({ success: true, bytes: content.length })
          } catch (error) {
            resolve({ success: false, error: error.message })
          }
        })

        response.on('error', (error) => {
          clearTimeout(timeoutHandle)
          resolve({ success: false, error: error.message })
        })
      })
      .on('error', (error) => {
        clearTimeout(timeoutHandle)
        resolve({ success: false, error: error.message })
      })
  })
}

module.exports = { seedKmlLibrary, fetchKmlFromRemote }
