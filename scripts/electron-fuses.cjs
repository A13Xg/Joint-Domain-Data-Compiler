const path = require('path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

const EXPECTED_FUSES = Object.freeze({
  version: FuseVersion.V1,
  strictlyRequireAllFuses: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  // The packaged renderer is intentionally loaded with BrowserWindow.loadFile.
  // Keep Electron's file: privileges until the app migrates to a custom scheme.
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  [FuseV1Options.WasmTrapHandlers]: true,
})

function fuseConfigForPlatform(platform) {
  return {
    ...EXPECTED_FUSES,
    // electron-builder embeds ASAR integrity metadata in Windows/macOS
    // executables. Linux has no equivalent executable resource.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: platform === 'win32' || platform === 'darwin',
  }
}

function packagedExecutablePath(context) {
  const productFilename = context.packager.appInfo.productFilename
  if (context.electronPlatformName === 'darwin') {
    return path.join(context.appOutDir, `${productFilename}.app`, 'Contents', 'MacOS', productFilename)
  }
  if (context.electronPlatformName === 'win32') {
    return path.join(context.appOutDir, `${productFilename}.exe`)
  }
  const executableName = context.packager.executableName || productFilename
  return path.join(context.appOutDir, executableName)
}

async function applyElectronFuses(context) {
  await flipFuses(packagedExecutablePath(context), fuseConfigForPlatform(context.electronPlatformName))
}

module.exports = applyElectronFuses
module.exports.EXPECTED_FUSES = EXPECTED_FUSES
module.exports.fuseConfigForPlatform = fuseConfigForPlatform
module.exports.packagedExecutablePath = packagedExecutablePath
