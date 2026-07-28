import { strict as assert } from 'node:assert'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
const { seedKmlLibrary } = createRequire(import.meta.url)(path.resolve(process.cwd(), 'electron/kml-seed.cjs'))

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jddc-kml-seed-'))
const sourceDir = path.join(root, 'seed')
const targetDir = path.join(root, 'library')
fs.mkdirSync(sourceDir)
fs.writeFileSync(path.join(sourceDir, 'Special_Use_Airspace.kml'), '<kml>seed</kml>')
fs.writeFileSync(path.join(sourceDir, 'ignored.txt'), 'ignored')

assert.deepEqual(seedKmlLibrary(sourceDir, targetDir), ['Special_Use_Airspace.kml'])
assert.equal(fs.readFileSync(path.join(targetDir, 'Special_Use_Airspace.kml'), 'utf8'), '<kml>seed</kml>')
fs.writeFileSync(path.join(targetDir, 'Special_Use_Airspace.kml'), '<kml>user copy</kml>')
assert.deepEqual(seedKmlLibrary(sourceDir, targetDir), [])
assert.equal(fs.readFileSync(path.join(targetDir, 'Special_Use_Airspace.kml'), 'utf8'), '<kml>user copy</kml>')
fs.rmSync(root, { recursive: true, force: true })
console.log('kml seed tests passed')
