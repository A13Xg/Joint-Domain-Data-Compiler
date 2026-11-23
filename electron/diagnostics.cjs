const fs = require('fs')
const path = require('path')

// Launch diagnostics that survive a launch nobody could see.
//
// A packaged Windows build is a GUI-subsystem executable: its stdout and stderr
// go nowhere, so every console line main.cjs ever printed -- the startup trace,
// the splash warnings, the fatal-error text -- was invisible on exactly the
// machines where launches hang or die. Reports of "it runs in the background
// and never shows anything" could not be answered with anything but guesses.
// This module writes that record to a file instead, and keeps the small amount
// of state that lets the next launch react to how the last one ended.
//
// Deliberately free of `electron` imports so test/electron-diagnostics.ts can
// drive it with plain directories.

const LOG_FILE_NAME = 'main.log'
const PREVIOUS_LOG_FILE_NAME = 'main.previous.log'
// Rotated at startup, not mid-run, so one launch is never split across files.
// Two generations at this size is weeks of normal launches and costs nothing.
const MAX_LOG_BYTES = 2 * 1024 * 1024
const LAUNCH_STATE_FILE_NAME = 'launch-state.json'

/**
 * Opens `<dir>/main.log` for appending, rotating it first when it is large.
 *
 * Writes are synchronous on purpose: the lines that matter most are the last
 * ones before a crash or a forced exit, and a buffered async writer loses
 * exactly those. Every failure is swallowed -- a read-only profile or a full
 * disk must not turn diagnostics into the reason the app cannot start.
 */
function createFileLog(dir) {
  const filePath = path.join(dir, LOG_FILE_NAME)
  let fd = null
  try {
    fs.mkdirSync(dir, { recursive: true })
    try {
      if (fs.statSync(filePath).size > MAX_LOG_BYTES) {
        fs.renameSync(filePath, path.join(dir, PREVIOUS_LOG_FILE_NAME))
      }
    } catch {
      // No log yet, which is the first-launch case.
    }
    fd = fs.openSync(filePath, 'a')
  } catch {
    fd = null
  }

  function write(level, text) {
    if (fd === null) return
    const stamp = new Date().toISOString()
    const lines = String(text).split(/\r?\n/)
    const body = lines.map((line, index) => `${index === 0 ? `${stamp} [${process.pid}] ${level.padEnd(5)}` : ' '.repeat(stamp.length + String(process.pid).length + 10)} ${line}`).join('\n')
    try {
      fs.writeSync(fd, `${body}\n`)
    } catch {
      // Disk full or the handle went away; nothing useful left to do.
    }
  }

  return {
    path: filePath,
    available: fd !== null,
    info: (text) => write('INFO', text),
    warn: (text) => write('WARN', text),
    error: (text) => write('ERROR', text),
  }
}

/**
 * Routes console.log/info/warn/error through the file log as well as their
 * original destination, so every existing `console.*` call in the main process
 * lands in the file without each one being rewritten.
 */
function mirrorConsole(log, target = console) {
  const levels = { log: 'info', info: 'info', warn: 'warn', error: 'error' }
  for (const [method, level] of Object.entries(levels)) {
    const original = target[method].bind(target)
    target[method] = (...args) => {
      original(...args)
      log[level](args.map(formatLogArgument).join(' '))
    }
  }
}

function formatLogArgument(value) {
  if (value instanceof Error) return value.stack || value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// Launch-state phases, in the order a healthy launch passes through them.
// `painted` means a window of ours reached Chromium's first paint -- the
// evidence that the GPU and compositor work on this machine.
const LAUNCH_PHASES = Object.freeze(['started', 'painted', 'ready'])

function readLaunchState(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, LAUNCH_STATE_FILE_NAME), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeLaunchState(dir, state) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, LAUNCH_STATE_FILE_NAME), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Decides whether this launch should run with hardware acceleration.
 *
 * A broken GPU driver, a VM, or a remote-desktop session can wedge or crash
 * Chromium's GPU process before anything paints, which on Windows looks
 * exactly like the reported failure: a process in Task Manager and no window.
 * The packaged smoke gate always passed `--disable-gpu`, so that path had
 * never been exercised anywhere. Nothing in the workbench uses WebGL (the
 * map is Leaflet DOM/SVG, charts and the 3D view are 2D canvas), so software
 * rendering costs some smoothness and no function.
 *
 * Software rendering is chosen when:
 *  - the user asked for it (JDDC_GPU=off, or --disable-gpu on the command line);
 *  - an earlier launch already proved hardware rendering broken here, which is
 *    remembered (`softwareRendering`) because alternating between a launch that
 *    hangs and one that works is worse than either;
 *  - the previous launch never painted a single window. A launch that painted
 *    and then failed later is NOT taken as GPU evidence -- that is a renderer
 *    or bundle problem, and switching rendering modes would only hide it.
 *
 * JDDC_GPU=on overrides all of it, for trying hardware again after a driver
 * update.
 */
function decideRendering(previous, env = {}, argv = []) {
  const forced = String(env.JDDC_GPU ?? '').toLowerCase()
  if (forced === 'on' || forced === '1' || forced === 'hardware') {
    return { software: false, reason: 'JDDC_GPU=on forces hardware rendering', remember: false }
  }
  if (forced === 'off' || forced === '0' || forced === 'software') {
    return { software: true, reason: 'JDDC_GPU=off forces software rendering', remember: false }
  }
  if (argv.includes('--disable-gpu')) {
    return { software: true, reason: '--disable-gpu was passed on the command line', remember: false }
  }
  if (previous.softwareRendering === true) {
    return {
      software: true,
      reason: `software rendering remembered from an earlier launch (${typeof previous.softwareReason === 'string' ? previous.softwareReason : 'no reason recorded'}); set JDDC_GPU=on to retry hardware`,
      remember: false,
    }
  }
  if (previous.phase === 'started' && previous.rendering === 'hardware') {
    return {
      software: true,
      reason: `the previous launch (${typeof previous.startedAt === 'string' ? previous.startedAt : 'unknown time'}) never painted a window with hardware rendering`,
      remember: true,
    }
  }
  return { software: false, reason: null, remember: false }
}

module.exports = {
  LAUNCH_PHASES,
  LAUNCH_STATE_FILE_NAME,
  LOG_FILE_NAME,
  MAX_LOG_BYTES,
  PREVIOUS_LOG_FILE_NAME,
  createFileLog,
  decideRendering,
  mirrorConsole,
  readLaunchState,
  writeLaunchState,
}
