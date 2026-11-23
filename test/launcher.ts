// launcher/Launcher.cs: the Windows program that puts the splash up at the
// double-click and then starts the Electron app.
//
// The launcher only RUNS on Windows, and only the release runner builds it
// there. What can be pinned anywhere is pinned here: that the C# compiles at the
// language level the in-box Windows compiler accepts, that arguments are
// forwarded with the quoting Windows itself parses, that the splash draws, and
// that every file which has to agree on a name or an ID does. The compile and
// run checks use Mono when it is installed and SKIP otherwise.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { LAUNCHER_FILE_NAME, buildLauncher, findCompiler } from '../scripts/build-launcher.mjs'
import { LAUNCHER_FILE_NAME as ZIP_LAUNCHER_FILE_NAME } from '../scripts/package-zip.mjs'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const source = readFileSync('launcher/Launcher.cs', 'utf8')
const mainProcess = readFileSync('electron/main.cjs', 'utf8')
const installerHook = readFileSync('build/installer.nsh', 'utf8')
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  build: { appId: string; productName: string; win: { executableName: string; extraFiles?: { from: string; to: string; filter: string[] }[] }; nsis: { include?: string } }
  scripts: Record<string, string>
}

// --- names and IDs that several files must agree on ---
const csharpId = /AppUserModelId = "([^"]+)"/.exec(source)?.[1]
const electronId = /APP_USER_MODEL_ID = '([^']+)'/.exec(mainProcess)?.[1]
check('the launcher, the app and the installer share one taskbar ID (build.appId)', csharpId === pkg.build.appId && electronId === pkg.build.appId, `${csharpId} / ${electronId} / ${pkg.build.appId}`)
check('the launcher starts the executable electron-builder produces', source.includes(`AppExeName = "${pkg.build.win.executableName}.exe"`))
check('the launcher is named after the product, and never collides with the app executable',
  LAUNCHER_FILE_NAME === `${pkg.build.productName}.exe` && LAUNCHER_FILE_NAME !== `${pkg.build.win.executableName}.exe` && ZIP_LAUNCHER_FILE_NAME === LAUNCHER_FILE_NAME)
check('the launcher is copied in beside the app', pkg.build.win.extraFiles?.some((entry) => entry.from === 'build/launcher' && entry.to === '.' && entry.filter.includes(LAUNCHER_FILE_NAME)) === true)
check('the Windows build compiles the launcher before packaging', /build-launcher\.mjs && electron-builder --win/.test(pkg.scripts['build:desktop:win'] ?? ''))
check('the installer hook is wired in', pkg.build.nsis.include === 'build/installer.nsh')
check('the installer re-points both shortcuts at the launcher',
  (installerHook.match(new RegExp(`CreateShortCut "\\$new(StartMenu|Desktop)Link" "\\$INSTDIR\\\\${LAUNCHER_FILE_NAME.replace(/ /g, ' ')}"`, 'g')) ?? []).length === 2)
check('the re-pointed shortcuts keep the app icon and taskbar ID', (installerHook.match(/"\$appExe" 0/g) ?? []).length === 2 && (installerHook.match(/SetLnkAUMI/g) ?? []).length === 2)
check('the Windows release gate installs and launches through the shortcut target', /smoke-installer\.mjs/.test(pkg.scripts['check:desktop:win'] ?? ''))

// --- behaviour the source must keep ---
check('the app is started by CreateProcess, not ShellExecute (no second SmartScreen prompt)', source.includes('info.UseShellExecute = false;'))
check('the splash is painted before the app is started', /Refresh\(\);[\s\S]{0,400}ChildLauncher\.Start\(/.test(source))
check('the app is told the launcher splash rectangle and the double-click time',
  source.includes('"JDDC_LAUNCHER_BOUNDS"') && source.includes('"JDDC_SPAWN_MS"') && mainProcess.includes('JDDC_LAUNCHER_BOUNDS') && mainProcess.includes('screenToDipRect'))
check('the app removes the launcher variables from its environment', /delete process\.env\.JDDC_LAUNCHER_BOUNDS/.test(mainProcess) && /delete process\.env\.JDDC_SPAWN_MS/.test(mainProcess))
check('under the launcher the app splash waits for its artwork, so the swap shows no dark frame',
  /if \(launcher && \(why === 'created' \|\| why === 'first paint'\)\) return/.test(mainProcess))
check('a launcher opened from inside the zip explains how to extract', /extract the whole zip first/.test(source))
check('the spawn-to-main.cjs gap is logged on every launch', /traceLine\(`\[startup\][^`]*process spawn to main\.cjs/.test(mainProcess) && /function traceLine\(line\) \{\n\s+launchLog\.info\(line\)/.test(mainProcess))

// --- compile and run (Mono) ---
const compiler = findCompiler()
if (!compiler || spawnSync('mono', ['--version']).status !== 0) {
  console.log('  [SKIP] no C# compiler/runtime here (install mono-mcs and mono-runtime); the Windows release build compiles it with csc.')
} else {
  const outDir = resolve('.test-build', 'launcher')
  rmSync(outDir, { recursive: true, force: true })
  let built = ''
  try {
    built = buildLauncher(join(outDir, LAUNCHER_FILE_NAME))
  } catch (error) {
    console.log(String(error))
  }
  check('compiles as C# 5 with warnings as errors', built !== '' && existsSync(built))
  if (built) {
    const forwarded = (args: string[]) => spawnSync('mono', [built, '--print-command-line', ...args], { encoding: 'utf8', env: { ...process.env, JDDC_LOG_DIR: outDir } }).stdout
    // Known answers from the CommandLineToArgvW rules.
    const cases: [string[], string][] = [
      [['--disable-gpu', '--remote-debugging-port=9222'], '--disable-gpu --remote-debugging-port=9222'],
      [['C:\\Data Files\\track.csv'], '"C:\\Data Files\\track.csv"'],
      [['say "hi"'], '"say \\"hi\\""'],
      [['C:\\dir with space\\'], '"C:\\dir with space\\\\"'],
      [['a\\\\"b'], '"a\\\\\\\\\\"b"'],
      [[''], '""'],
    ]
    for (const [args, expected] of cases) {
      const actual = forwarded(args)
      check(`forwards ${JSON.stringify(args)} as ${expected}`, actual === expected, actual)
    }
    const png = join(outDir, 'splash.png')
    spawnSync('mono', [built, '--render-splash', png, '0.12', 'hint'], { env: { ...process.env, JDDC_LOG_DIR: outDir } })
    const bytes = existsSync(png) ? readFileSync(png) : Buffer.alloc(0)
    const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    check('draws the splash at the app splash size (800x343)', isPng && bytes.readUInt32BE(16) === 800 && bytes.readUInt32BE(20) === 343)
    check('embeds the splash art', bytes.length > 100_000, `${bytes.length} bytes`)
  }
  rmSync(outDir, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? 'ALL LAUNCHER CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
