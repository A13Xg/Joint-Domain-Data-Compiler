import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

// Compiles launcher/Launcher.cs into "Joint Domain Data Compiler.exe": the
// small Windows program that shows the splash the instant it is double-clicked
// and then starts the real app (see the header of that file for why).
//
// On Windows it uses the C# compiler that ships inside every .NET Framework 4.x
// install, so the release runner needs nothing extra. Elsewhere it uses Mono's
// `mcs` when installed -- the same C# 5 language level -- which is what lets
// test/launcher.ts compile and exercise it on a Linux checkout.
//
// Usage: node scripts/build-launcher.mjs [output.exe]
//        default output: build/launcher/Joint Domain Data Compiler.exe

export const LAUNCHER_FILE_NAME = 'Joint Domain Data Compiler.exe'

export function findCompiler() {
  if (process.platform === 'win32') {
    const windir = process.env.WINDIR ?? 'C:\\Windows'
    for (const framework of ['Framework64', 'Framework']) {
      const csc = join(windir, 'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe')
      if (existsSync(csc)) return { command: csc, flavour: 'csc' }
    }
    return null
  }
  const mcs = spawnSync('mcs', ['--version'], { encoding: 'utf8' })
  return mcs.status === 0 ? { command: 'mcs', flavour: 'mcs' } : null
}

export function buildLauncher(outFile) {
  const compiler = findCompiler()
  if (!compiler) {
    throw new Error(process.platform === 'win32'
      ? 'No .NET Framework 4.x C# compiler (csc.exe) found under %WINDIR%\\Microsoft.NET.'
      : 'No C# compiler found; install Mono (`mcs`) to build the launcher off Windows.')
  }
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const out = resolve(outFile)
  mkdirSync(dirname(out), { recursive: true })
  // Version resources, so Explorer's Properties tab and the launcher's own
  // splash can show the same version the app does.
  const numeric = String(pkg.version).split(/[-+]/)[0].split('.').map((part) => Number.parseInt(part, 10) || 0)
  while (numeric.length < 4) numeric.push(0)
  const assemblyInfo = join(dirname(out), 'AssemblyInfo.generated.cs')
  writeFileSync(assemblyInfo, [
    'using System.Reflection;',
    `[assembly: AssemblyTitle(${JSON.stringify(pkg.build.productName)})]`,
    `[assembly: AssemblyProduct(${JSON.stringify(pkg.build.productName)})]`,
    `[assembly: AssemblyDescription("Starts ${pkg.build.productName} and shows its splash at once")]`,
    `[assembly: AssemblyVersion("${numeric.join('.')}")]`,
    `[assembly: AssemblyFileVersion("${numeric.join('.')}")]`,
    `[assembly: AssemblyInformationalVersion(${JSON.stringify(pkg.version)})]`,
    '',
  ].join('\n'))

  // csc takes /switches; mcs takes the same switches with '-', and on Unix a
  // leading '/' would read as a path.
  const flag = compiler.flavour === 'mcs' ? '-' : '/'
  const args = [
    ...(compiler.flavour === 'csc' ? ['nologo'] : []),
    'target:winexe',
    'optimize+',
    'warnaserror+',
    // CS1668: an invalid directory in the LIB variable, which some machines
    // have and which says nothing about this code.
    'nowarn:1668',
    'langversion:5',
    `out:${out}`,
    'r:System.Windows.Forms.dll',
    'r:System.Drawing.dll',
    `resource:${resolve('electron/splash.png')},Jddc.splash.png`,
    `win32icon:${resolve('build/icon.ico')}`,
  ].map((option) => `${flag}${option}`)
  args.push(resolve('launcher/Launcher.cs'), assemblyInfo)
  const result = spawnSync(compiler.command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`Launcher compile failed (${compiler.command}):\n${result.stdout}${result.stderr}`)
  }
  return out
}

if (process.argv[1] && basename(process.argv[1]) === 'build-launcher.mjs') {
  const out = buildLauncher(process.argv[2] ?? join('build', 'launcher', LAUNCHER_FILE_NAME))
  console.log(`Built ${out}`)
}
