// npm test: builds first (see package.json), then runs every suite against dist/client in headless Chrome.
// Run a single suite with: node tests/run.mjs app
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { results } from './lib/assert.mjs'
import { findChrome } from './lib/browser.mjs'

const DIST = fileURLToPath(new URL('../dist/client', import.meta.url))
const SUITES = ['api', 'push', 'app', 'backup', 'baby', 'settings', 'rhythm', 'reminder', 'report', 'sync', 'notify', 'babies', 'care', 'install', 'layout', 'contrast', 'upgrade']

if (!existsSync(DIST + '/index.html')) { console.error('dist/client is missing: run npm run build first'); process.exit(1) }
if (!findChrome()) { console.error('Chrome not found: set CHROME_PATH'); process.exit(1) }

const only = process.argv.slice(2)
for (const name of only.length ? only : SUITES) {
  const mod = await import(`./${name}.test.mjs`)
  try {
    await mod.run(DIST)
  } catch (e) {
    results.push({ suite: name, name: 'crashed', ok: false, detail: String(e.stack || e).split('\n').slice(0, 3).join(' | ') })
    console.log(`  ✗ ${name} crashed: ${e.stack || e}`)
  }
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('Failed:\n' + failed.map((f) => `  ${f.suite} › ${f.name}`).join('\n'))
  // on GitHub Actions, failures also become annotations, readable on the run page without opening the logs
  if (process.env.GITHUB_ACTIONS) {
    // the message escapes %, CR and LF; property values (the title) also escape , and :
    const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
    const escProp = (s) => esc(s).replace(/,/g, '%2C').replace(/:/g, '%3A')
    failed.forEach((f) => console.log(`::error title=${escProp(f.suite + ' › ' + f.name)}::${esc(f.detail || 'failed')}`))
  }
  process.exit(1)
}
