// The project is AGPL-3.0, and everything compiled into it has to be
// compatible with that and credited. react-leaflet once shipped under the
// Hippocratic License -- use restrictions the AGPL forbids adding -- and no
// check noticed. This one would have.
import { existsSync, readFileSync } from 'node:fs'
import { ALLOWED_LICENSES, NOTICES_FILE, collectRuntimePackages, licenseProblems, renderNotices } from '../scripts/third-party-notices.mjs'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  [${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  license?: string
  build: { files: string[]; win: { extraFiles?: { from: string }[] }; linux: { extraFiles?: { from: string }[] } }
}
check('package.json declares the AGPL', pkg.license === 'AGPL-3.0-only')
check('the LICENSE file is the GNU AGPL v3', existsSync('LICENSE') && /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/.test(readFileSync('LICENSE', 'utf8')))

const packages = collectRuntimePackages()
const problems = licenseProblems(packages)
check('every runtime dependency is under an AGPL-compatible license and ships its license text', problems.length === 0, problems.join(' '))
check('react-leaflet (Hippocratic License) is gone from the runtime tree', !packages.some((entry) => entry.name.startsWith('react-leaflet') || entry.name === '@react-leaflet/core'))
check(`${NOTICES_FILE} matches the current dependency tree`, existsSync(NOTICES_FILE) && readFileSync(NOTICES_FILE, 'utf8') === renderNotices(packages), 'run: node scripts/third-party-notices.mjs')

// The guard itself.
const sample = (license: string) => [{ name: 'x', version: '1.0.0', license, homepage: '', licenseText: 'text' }]
check('a Hippocratic-licensed package is rejected', licenseProblems(sample('Hippocratic-2.1')).length === 1)
check('a non-commercial license is rejected', licenseProblems(sample('PolyForm-Noncommercial-1.0.0')).length === 1)
check('a permissive license is accepted', licenseProblems(sample('MIT')).length === 0)
check('"A OR B" is accepted when either option is allowed', licenseProblems(sample('(MIT OR GPL-3.0-only)')).length === 0)
check('"A AND B" needs both allowed', licenseProblems(sample('MIT AND Hippocratic-2.1')).length === 1)
check('a package without a license text is reported', licenseProblems([{ ...sample('MIT')[0]!, licenseText: null }]).length === 1)
check('the allowlist holds no copyleft or restricted licenses', ![...ALLOWED_LICENSES].some((id) => /GPL|Hippocratic|NonCommercial|Noncommercial|SSPL|BUSL/i.test(id)))

// Every copy carries both files: the web build (vite.config.ts copies them
// into dist/, which every desktop package contains) and, visibly, beside the
// desktop executable.
const viteConfig = readFileSync('vite.config.ts', 'utf8')
check('the web build copies LICENSE and the notices into its output', /LICENSE/.test(viteConfig) && viteConfig.includes(NOTICES_FILE))
for (const platform of ['win', 'linux'] as const) {
  const extra = (pkg.build[platform].extraFiles ?? []).map((entry) => entry.from)
  check(`${platform} packages place LICENSE and the notices beside the executable`, extra.includes('LICENSE') && extra.includes(NOTICES_FILE))
}

// AGPL section 13: anyone using the program over a network -- the browser
// build -- must be offered its source.
const about = readFileSync('src/ui/AboutDialog.tsx', 'utf8')
check('the About dialog offers the complete source code', /SOURCE_URL = 'https:\/\/github\.com\/A13Xg\/Joint-Domain-Data-Compiler'/.test(about) && /source code<\/a>/.test(about))
check('the About dialog no longer claims "All rights reserved"', !/All rights reserved/.test(about))

console.log(`\n${failures === 0 ? 'ALL THIRD-PARTY NOTICE CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
