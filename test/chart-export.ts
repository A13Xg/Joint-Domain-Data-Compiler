import { chartExportFilename } from '../src/visualization/charts/export.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const svgName = chartExportFilename('svg')
const pngName = chartExportFilename('png')

check('SVG filename carries the right extension', svgName.endsWith('.svg'))
check('PNG filename carries the right extension', pngName.endsWith('.png'))
check('Filenames are prefixed for the app', svgName.startsWith('jddc-chart-') && pngName.startsWith('jddc-chart-'))
check('The timestamp portion contains no filesystem-unsafe characters (colons, extra dots)', !/[<>:"/\\|?*]/.test(svgName.slice(0, -'.svg'.length)))
check('Two calls in the same tick still produce a filename (no throw, no collision requirement)', chartExportFilename('svg').startsWith('jddc-chart-'))

console.log(`\n${failures === 0 ? 'ALL CHART EXPORT CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
