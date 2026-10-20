// npm test: builds first (see package.json), then runs every suite against dist/client in headless Chrome.
// Run a single suite with: node tests/run.mjs app
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { results } from './lib/assert.mjs'
import { findChrome } from './lib/browser.mjs'

const DIST = fileURLToPath(new URL('../dist/client', import.meta.url))
const SUITES = ['api', 'app', 'backup', 'baby', 'settings', 'rhythm', 'reminder', 'report', 'sync', 'install', 'layout', 'contrast', 'upgrade']

if (!existsSync(DIST + '/index.html')) { console.error('dist/client is missing: run npm run build first'); process.exit(1) }
if (!findChrome()) { console.error('Chrome not found: set CHROME_PATH'); process.exit(1) }

const only = process.argv.slice(2)
for (const name of only.length ? only : SUITES) {
  const mod = await import(`./${name}.test.mjs`)
  try {
    await mod.run(DIST)
  } catch (e) {
    results.push({ suite: name, name: 'crashed', ok: false })
    console.log(`  ✗ ${name} crashed: ${e.stack || e}`)
  }
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('Failed:\n' + failed.map((f) => `  ${f.suite} › ${f.name}`).join('\n'))
  process.exit(1)
}
