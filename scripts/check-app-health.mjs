import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const check = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✓ ${message}`)
}

console.log('Checking application build health...\n')

// Test 1: Built HTML exists and is valid
const indexPath = resolve('dist/index.html')
const html = readFileSync(indexPath, 'utf-8')

check(html.length > 0, 'index.html exists and has content')
check(html.includes('<!doctype html>'), 'HTML has valid doctype')
// Not `<div id="root"></div>` verbatim: the root now carries a static
// loading skeleton (see index.html) that createRoot(...).render() replaces
// wholesale on mount, so the built HTML has real markup inside it.
check(/<div id="root">/.test(html), 'React root element exists')
check(html.includes('<script'), 'JavaScript is loaded')

// Test 2: Built output structure - check all required files exist
const distContents = readdirSync(resolve('dist'))
check(distContents.includes('index.html'), 'dist/index.html exists')
check(distContents.includes('assets'), 'dist/assets/ directory exists')

const assetsContents = readdirSync(resolve('dist/assets'))
const hasJs = assetsContents.some(f => f.endsWith('.js'))
const hasCss = assetsContents.some(f => f.endsWith('.css'))

check(hasJs, 'JavaScript bundles exist in dist/assets/')
check(hasCss, 'CSS bundle exists in dist/assets/')

// Test 3: Worker bundles for transforms (required for resampling, CSV analysis)
const hasWorkerJs = assetsContents.some(f => f.includes('worker') && f.endsWith('.js'))
check(hasWorkerJs, 'Web Worker bundles exist')

console.log(`\n✓ Built ${assetsContents.length} assets successfully`)
console.log('\n✅ Application health check passed!')
