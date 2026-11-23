import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { smokeLaunch } from './smoke-packaged.mjs'

// Windows release gate for the installer itself. Every other gate launches
// files straight out of release/; this one does what a user does: runs
// Setup.exe (silently), starts the app through what the installer put on the
// Start menu, then uninstalls.
//
// It checks the part only the installer controls: build/installer.nsh
// re-points the Start menu and desktop shortcuts at the launcher
// ("Joint Domain Data Compiler.exe"), so a click on them shows the splash at
// once instead of waiting on the 190 MB Electron executable.

const LAUNCHER_FILE_NAME = 'Joint Domain Data Compiler.exe'
const PRODUCT_NAME = 'Joint Domain Data Compiler'

if (process.platform !== 'win32') {
  console.log('Installer smoke is Windows-only; skipped.')
  process.exit(0)
}

function powershell(script, env = {}) {
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', env: { ...process.env, ...env } })
  if (result.status !== 0) throw new Error(`PowerShell failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

function installedApp() {
  const json = powershell(`
    $keys = Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' -ErrorAction SilentlyContinue
    $app = $keys | Get-ItemProperty | Where-Object { $_.DisplayName -like '${PRODUCT_NAME}*' } | Select-Object -First 1 InstallLocation, QuietUninstallString, UninstallString, DisplayVersion
    if ($app) { $app | ConvertTo-Json -Compress } else { 'null' }
  `)
  return JSON.parse(json || 'null')
}

function shortcutTarget(path) {
  return powershell('if (Test-Path -LiteralPath $env:LNK) { (New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK).TargetPath } else { "" }', { LNK: path })
}

const setup = (await readdir('release')).filter((name) => /Windows-x64-Setup\.exe$/.test(name))
if (setup.length !== 1) throw new Error(`Expected exactly one installer in release/, found ${setup.length}.`)
const setupPath = resolve('release', setup[0])

console.log(`Installing ${setupPath} silently`)
const install = spawnSync(setupPath, ['/S'], { stdio: 'inherit' })
if (install.status !== 0) throw new Error(`The installer exited with ${install.status}.`)

const app = installedApp()
if (!app?.InstallLocation) throw new Error('The installer finished but no uninstall entry with an InstallLocation was registered.')
const installDir = app.InstallLocation
console.log(`Installed ${app.DisplayVersion} to ${installDir}`)

const launcherPath = join(installDir, LAUNCHER_FILE_NAME)
const shortcuts = [
  ['Start menu', join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${PRODUCT_NAME}.lnk`)],
  ['Desktop', join(powershell('[Environment]::GetFolderPath("Desktop")'), `${PRODUCT_NAME}.lnk`)],
]
let failure = null
try {
  if (!existsSync(launcherPath)) throw new Error(`The launcher was not installed at ${launcherPath}.`)
  for (const [label, link] of shortcuts) {
    const target = shortcutTarget(link)
    console.log(`${label} shortcut ${link} -> ${target || '(missing)'}`)
    if (!target) throw new Error(`The installer created no ${label} shortcut at ${link}.`)
    if (resolve(target).toLowerCase() !== resolve(launcherPath).toLowerCase()) {
      throw new Error(`The ${label} shortcut starts ${target}, not the launcher (${launcherPath}).`)
    }
  }
  // Launched by the shortcut's own target, so the copy and the files under
  // test are exactly the installed ones.
  // With the real default log folder, so the folder the user guide names is
  // proven to be where an installed copy writes.
  await smokeLaunch({ executable: launcherPath, description: 'installed copy, via the Start menu shortcut target, default log folder', defaultLogDir: true })
} catch (error) {
  failure = error
} finally {
  const uninstaller = app.QuietUninstallString || (app.UninstallString ? `${app.UninstallString} /S` : null)
  if (uninstaller) {
    console.log(`Uninstalling: ${uninstaller}`)
    // The uninstall string is a quoted path plus switches; let cmd parse it.
    spawnSync('cmd', ['/d', '/s', '/c', `"${uninstaller}"`], { stdio: 'inherit', windowsVerbatimArguments: true })
  }
}
if (failure) throw failure

// The uninstaller relaunches itself from %TEMP% and returns before it is done.
for (const deadline = Date.now() + 60_000; Date.now() < deadline; await new Promise((wait) => setTimeout(wait, 500))) {
  if (!existsSync(launcherPath) && !installedApp()) break
}
if (existsSync(launcherPath)) throw new Error(`Uninstall left ${launcherPath} behind.`)
if (installedApp()) throw new Error('Uninstall left its registry entry behind.')
// The re-pointed shortcuts keep electron-builder's names, so its uninstaller
// must still find and remove them.
for (const [label, link] of shortcuts) {
  if (existsSync(link)) throw new Error(`Uninstall left the ${label} shortcut behind: ${link}`)
}
console.log('Installer smoke passed: installed, shortcuts start the launcher, launched, uninstalled cleanly.')
