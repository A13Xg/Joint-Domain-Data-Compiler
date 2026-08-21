import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { FuseV1Options, FuseVersion } from '@electron/fuses'

const {
  EXPECTED_FUSES,
  fuseConfigForPlatform,
  packagedExecutablePath,
} = createRequire(import.meta.url)(resolve(process.cwd(), 'scripts/electron-fuses.cjs'))

let failures = 0
function check(name: string, condition: boolean): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}`)
}

const context = (platform: string, appOutDir: string, productFilename = 'JointDomainDataCompiler') => ({
  electronPlatformName: platform,
  appOutDir,
  packager: { appInfo: { productFilename }, executableName: 'joint-domain-data-compiler' },
})

check('Fuse version is explicit', EXPECTED_FUSES.version === FuseVersion.V1)
check('Future Electron fuses cannot be silently omitted', EXPECTED_FUSES.strictlyRequireAllFuses === true)
check('ELECTRON_RUN_AS_NODE is disabled', EXPECTED_FUSES[FuseV1Options.RunAsNode] === false)
check('Cookie encryption is enabled', EXPECTED_FUSES[FuseV1Options.EnableCookieEncryption] === true)
check('NODE_OPTIONS is disabled', EXPECTED_FUSES[FuseV1Options.EnableNodeOptionsEnvironmentVariable] === false)
check('Node CLI inspect arguments are disabled', EXPECTED_FUSES[FuseV1Options.EnableNodeCliInspectArguments] === false)
check('Embedded ASAR integrity is required on Windows', fuseConfigForPlatform('win32')[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] === true)
check('Embedded ASAR integrity is required on macOS', fuseConfigForPlatform('darwin')[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] === true)
check('Unsupported embedded ASAR integrity is disabled on Linux', fuseConfigForPlatform('linux')[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] === false)
check('Only packaged ASAR application code can load', EXPECTED_FUSES[FuseV1Options.OnlyLoadAppFromAsar] === true)
check('File protocol privileges remain enabled for BrowserWindow.loadFile', EXPECTED_FUSES[FuseV1Options.GrantFileProtocolExtraPrivileges] === true)
// appOutDir comes from electron-builder and is always a host path, so packaging
// Windows from a POSIX host must keep POSIX separators. The executable is named
// after productFilename, not executableName.
check('Windows executable path follows electron-builder output', packagedExecutablePath(context('win32', '/release')) === '/release/JointDomainDataCompiler.exe')
check('Linux executable path uses configured executable name', packagedExecutablePath(context('linux', '/release')) === '/release/joint-domain-data-compiler')
check('macOS executable path targets the app bundle', packagedExecutablePath(context('darwin', '/release', 'JDDC')) === '/release/JDDC.app/Contents/MacOS/JDDC')

console.log(`\n${failures === 0 ? 'ALL ELECTRON FUSE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
