import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Electron loads the packaged renderer with file://. Relative assets keep
  // the module/CSS URLs inside app.asar/dist instead of resolving from C:/.
  base: './',
  plugins: [react()],
})
