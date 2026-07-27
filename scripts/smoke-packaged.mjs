import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const executable = resolve(process.argv[2] ?? await defaultExecutable())
const expectedTitle = 'Joint Domain Data Compiler'
const expectedUrlFragment = 'app.asar/dist/index.html'
const port = await availablePort()
const output = []
const electronArgs = ['--disable-gpu', `--remote-debugging-port=${port}`]
const command = process.platform === 'linux' ? 'xvfb-run' : executable
const args = process.platform === 'linux' ? ['-a', executable, ...electronArgs] : electronArgs
const child = spawn(command, args, {
  detached: process.platform !== 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
})

child.stdout.on('data', (chunk) => output.push(String(chunk)))
child.stderr.on('data', (chunk) => output.push(String(chunk)))

try {
  const page = await waitForRenderer(port, child)
  console.log(`Packaged ${process.platform} renderer launched: ${page.title}`)
} catch (error) {
  const detail = output.join('').trim()
  if (detail) console.error(detail)
  throw error
} finally {
  stopPackagedApp(child)
}

async function defaultExecutable() {
  if (process.platform === 'win32') return 'release/win-unpacked/JointDomainDataCompiler.exe'
  if (process.platform === 'linux') return 'release/linux-unpacked/joint-domain-data-compiler'
  if (process.platform === 'darwin') {
    const outputDirectory = (await readdir('release', { withFileTypes: true }))
      .find((entry) => entry.isDirectory() && entry.name.startsWith('mac'))?.name
    if (!outputDirectory) throw new Error('Could not find the unpacked macOS application directory.')
    return join('release', outputDirectory, 'Joint Domain Data Compiler.app', 'Contents', 'MacOS', 'Joint Domain Data Compiler')
  }
  throw new Error(`Packaged smoke is not configured for ${process.platform}.`)
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const allocated = typeof address === 'object' && address ? address.port : null
      server.close((error) => error ? reject(error) : allocated ? resolvePort(allocated) : reject(new Error('Could not allocate a smoke-test port')))
    })
  })
}

async function waitForRenderer(port, processHandle) {
  const deadline = Date.now() + 30_000
  let lastPage = null
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Packaged application exited early with code ${processHandle.exitCode}.`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find((target) => target.type === 'page')
        if (page) {
          lastPage = page
          if (page.url.includes(expectedUrlFragment) && page.title === expectedTitle) return page
        }
      }
    } catch {
      // Electron has not opened the debugging endpoint yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  const observed = lastPage ? ` Last page was ${JSON.stringify({ title: lastPage.title, url: lastPage.url })}.` : ''
  throw new Error(`Packaged renderer did not become ready within 30 seconds.${observed}`)
}

function stopPackagedApp(processHandle) {
  if (!processHandle.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(processHandle.pid), '/t', '/f'], { stdio: 'ignore' })
    return
  }
  try { process.kill(-processHandle.pid, 'SIGTERM') } catch {}
  setTimeout(() => {
    try { process.kill(-processHandle.pid, 'SIGKILL') } catch {}
  }, 1_000).unref()
}
