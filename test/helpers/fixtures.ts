// Single definition of where test fixtures live. Resolved against the repo root
// (the test runner's cwd) rather than this file's location, because esbuild
// bundles harnesses into .test-build/ before running them.
import { join } from 'node:path'

export const FIXTURES = join(process.cwd(), 'test', 'fixtures') + '/'
export const INVALID_FIXTURES = join(FIXTURES, 'invalid') + '/'
