import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  // Electron loads the packaged renderer with file://. Relative assets keep
  // the module/CSS URLs inside app.asar/dist instead of resolving from C:/.
  base: './',
  plugins: [react()],
  // Single source of truth for the version string embedded in project
  // manifests, HTML reports, and diagnostic bundles — previously hand-typed
  // in three places in ProjectPanel.tsx and drifted from package.json.
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
})
