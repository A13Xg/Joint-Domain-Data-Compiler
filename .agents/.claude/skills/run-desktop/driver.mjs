#!/usr/bin/env node
/**
 * JDDC Desktop App Driver
 *
 * Launches the built Electron app via xvfb-run (Linux) or directly (macOS/Windows),
 * connects to the debugger, and provides interactive commands for testing.
 *
 * Usage (interactive REPL):
 *   node driver.mjs
 *
 * Usage (single command):
 *   node driver.mjs build
 *   node driver.mjs launch
 *   node driver.mjs smoke
 */

import { spawn, spawnSync, execSync } from 'node:child_process'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import readline from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '../../..')

let appProcess = null
let debugPort = null
let screenshotDir = join(projectRoot, '.screenshots')
const stateFile = join(projectRoot, '.jddc-driver-state.json')

// Ensure screenshot directory exists
try {
  if (!existsSync(screenshotDir)) {
    execSync(`mkdir -p "${screenshotDir}"`)
  }
} catch (e) {
  screenshotDir = projectRoot
}

// Load any existing state from a previous invocation
function loadState() {
  try {
    if (existsSync(stateFile)) {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'))
      if (state.pid && state.port) {
        // Verify the process still exists
        try {
          process.kill(state.pid, 0)
          appProcess = { pid: state.pid }
          debugPort = state.port
          return
        } catch {
          // Process not running, clean up state
          unlinkSync(stateFile)
        }
      }
    }
  } catch (e) {
    // Ignore errors reading state
  }
}

// Save state for next invocation
function saveState() {
  if (appProcess && debugPort) {
    try {
      writeFileSync(stateFile, JSON.stringify({ pid: appProcess.pid, port: debugPort }, null, 2))
    } catch (e) {
      // Ignore errors saving state
    }
  }
}

// Clear state
function clearState() {
  try {
    if (existsSync(stateFile)) {
      unlinkSync(stateFile)
    }
  } catch (e) {
    // Ignore
  }
}

loadState()

const commands = {
  async build() {
    console.log('Building desktop app...')
    try {
      execSync('npm run build:desktop', { cwd: projectRoot, stdio: 'inherit' })
      console.log('✓ Desktop build complete')
      return 'ok'
    } catch (e) {
      console.error('✗ Build failed')
      return 'error'
    }
  },

  async launch() {
    if (appProcess) {
      console.warn('App already running. Use "quit" first.')
      return 'already-running'
    }

    console.log('Launching desktop app...')
    debugPort = await availablePort()
    const isLinux = process.platform === 'linux'

    const getExecutable = () => {
      if (isLinux) return 'release/linux-unpacked/joint-domain-data-compiler'
      if (process.platform === 'darwin') return 'release/mac/Joint Domain Data Compiler.app/Contents/MacOS/Joint Domain Data Compiler'
      if (process.platform === 'win32') return 'release/win-unpacked/JointDomainDataCompiler.exe'
      throw new Error(`Unsupported platform: ${process.platform}`)
    }

    const executable = resolve(projectRoot, getExecutable())
    if (!existsSync(executable)) {
      console.error(`✗ Executable not found: ${executable}`)
      console.error('  Run: build')
      return 'error'
    }

    const electronArgs = ['--disable-gpu', `--remote-debugging-port=${debugPort}`]
    const inCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
    if (isLinux || inCi) {
      electronArgs.push('--no-sandbox', '--disable-setuid-sandbox')
    }

    const command = isLinux ? 'xvfb-run' : executable
    const args = isLinux ? ['-a', executable, ...electronArgs] : electronArgs

    try {
      appProcess = spawn(command, args, {
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      console.log(`✓ App launched (PID: ${appProcess.pid}, debug port: ${debugPort})`)
      saveState()
      return 'ok'
    } catch (e) {
      console.error('✗ Failed to launch:', e.message)
      return 'error'
    }
  },

  async smoke() {
    if (!appProcess) {
      console.error('App not running. Use: launch')
      return 'error'
    }

    console.log('Running smoke test...')
    try {
      const page = await waitForRenderer(debugPort, appProcess)
      await waitForWorkbenchMounted(page.webSocketDebuggerUrl)
      console.log(`✓ App renderer mounted successfully`)
      console.log(`  Title: ${page.title}`)
      console.log(`  URL: ${page.url}`)
      return 'ok'
    } catch (e) {
      console.error('✗ Smoke test failed:', e.message)
      return 'error'
    }
  },

  async ss(filename) {
    if (!appProcess) {
      console.error('App not running. Use: launch')
      return 'error'
    }

    if (!filename) {
      filename = `screenshot-${Date.now()}.png`
    }
    const filepath = join(screenshotDir, filename)

    try {
      // Try ImageMagick first (better quality)
      if (process.platform === 'linux') {
        try {
          execSync(`import -window root "${filepath}"`)
        } catch {
          // Fall back to gnome-screenshot if ImageMagick not available
          execSync(`gnome-screenshot -f "${filepath}"`)
        }
      } else {
        console.log('Screenshot via screencapture (macOS) - not yet implemented')
        return 'error'
      }

      console.log(`✓ Screenshot: ${filepath}`)
      return 'ok'
    } catch (e) {
      console.error('✗ Screenshot failed:', e.message)
      return 'error'
    }
  },

  async wait(ms) {
    const millis = parseInt(ms)
    if (isNaN(millis)) {
      console.error('Usage: wait <milliseconds>')
      return 'error'
    }
    process.stdout.write(`Waiting ${millis}ms...`)
    await new Promise(r => setTimeout(r, millis))
    console.log(' done')
    return 'ok'
  },

  async eval(expr) {
    if (!appProcess) {
      console.error('App not running. Use: launch')
      return 'error'
    }

    try {
      const result = await evaluateDevTools(`(${expr})`)
      console.log('Result:', result)
      return 'ok'
    } catch (e) {
      console.error('Eval failed:', e.message)
      return 'error'
    }
  },

  async quit() {
    if (appProcess) {
      console.log('Closing app...')
      stopApp(appProcess)
      appProcess = null
      debugPort = null
      clearState()
      console.log('✓ App closed')
    } else {
      clearState()
    }
    return 'ok'
  },

  async info() {
    if (appProcess) {
      console.log(`App running: PID ${appProcess.pid}, debug port ${debugPort}`)
    } else {
      console.log('App not running')
    }
    console.log(`Screenshots: ${screenshotDir}`)
    return 'ok'
  },

  help() {
    console.log(`
JDDC Desktop App Driver - Commands:

SETUP:
  build           Build the desktop app
  launch          Start the app (runs build first if needed)

TESTING:
  smoke           Run smoke test (verify app mounted)
  ss [file.png]   Take screenshot

UTILITIES:
  wait MS         Wait milliseconds
  eval EXPR       Evaluate JavaScript in app
  info            Show process info
  quit            Close app and exit
  help            Show this message

INTERACTIVE REPL MODE:
  Run with no arguments for interactive mode where you can type
  commands and see results interactively.

EXAMPLES:
  $ node driver.mjs build
  $ node driver.mjs launch
  $ node driver.mjs smoke
  $ node driver.mjs ss app.png
  $ node driver.mjs quit

  Interactive:
  $ node driver.mjs
  jddc> launch
  jddc> smoke
  jddc> ss
  jddc> quit
    `)
    return 'ok'
  },
}

// Helper functions
function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : null
      server.close((err) => (err ? reject(err) : port ? resolve(port) : reject(new Error('Could not allocate port'))))
    })
  })
}

async function waitForRenderer(port, proc) {
  const deadline = Date.now() + 30_000
  let lastPage = null

  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`App exited with code ${proc.exitCode}`)

    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (resp.ok) {
        const targets = await resp.json()
        const page = targets.find((t) => t.type === 'page')
        if (page?.title === 'Joint Domain Data Compiler') return page
        if (page) lastPage = page
      }
    } catch {
      // Debugger not ready yet
    }

    await new Promise((r) => setTimeout(r, 250))
  }

  const hint = lastPage ? ` Got: ${lastPage.title}` : ''
  throw new Error(`Renderer didn't become ready.${hint}`)
}

async function waitForWorkbenchMounted(url) {
  if (typeof url !== 'string') throw new Error('No DevTools WebSocket URL')

  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    try {
      const state = await evaluateDevTools(
        url,
        `(() => {
          const root = document.querySelector('#root')
          return root && root.childElementCount > 0 && /Joint Domain Data Compiler|Import/i.test(root.textContent || '')
        })()`
      )

      if (state === true) return
    } catch {
      // Still loading
    }

    await new Promise((r) => setTimeout(r, 250))
  }

  throw new Error('Workbench did not mount')
}

function evaluateDevTools(url, expr) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('DevTools eval timeout'))
    }, 10_000)

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }))
    })

    ws.addEventListener('message', (evt) => {
      const resp = JSON.parse(String(evt.data))
      if (resp.id !== 1) return
      clearTimeout(timer)
      ws.close()
      if (resp.error || resp.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(resp.error || resp.result.exceptionDetails)))
      } else {
        resolve(resp.result?.result?.value)
      }
    })

    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('WebSocket connection failed'))
    })
  })
}

function stopApp(proc) {
  if (!proc?.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-proc.pid, 'SIGTERM')
    } catch {
      // Already dead
    }
    setTimeout(() => {
      try {
        process.kill(-proc.pid, 'SIGKILL')
      } catch {
        // Still dead
      }
    }, 1_000).unref()
  }
}

// Main
async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    // Interactive mode
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

    console.log('JDDC Desktop App Driver - Interactive Mode')
    commands.help()

    const prompt = () => {
      rl.question('jddc> ', async (line) => {
        const trimmed = line.trim()
        if (!trimmed) {
          prompt()
          return
        }

        const [cmd, ...params] = trimmed.split(/\s+/)

        if (cmd === 'exit' || cmd === 'quit') {
          await commands.quit()
          rl.close()
          process.exit(0)
        }

        const fn = commands[cmd]
        if (fn) {
          try {
            await fn(...params)
          } catch (e) {
            console.error('Error:', e.message)
          }
        } else if (cmd !== 'help') {
          console.error(`Unknown command: ${cmd}`)
        }
        prompt()
      })
    }

    prompt()
  } else {
    // Command mode
    const [cmd, ...params] = args
    const fn = commands[cmd]

    if (fn) {
      try {
        await fn(...params)
      } catch (e) {
        console.error('Error:', e.message)
        process.exit(1)
      }
    } else {
      console.error(`Unknown command: ${cmd}`)
      commands.help()
      process.exit(1)
    }

    // Auto-cleanup if not launching
    if (cmd !== 'launch' && appProcess) {
      await commands.quit()
    }
  }
}

process.on('SIGINT', async () => {
  console.log('\nShutting down...')
  await commands.quit()
  process.exit(0)
})

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
