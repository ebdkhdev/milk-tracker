// Writes dist/client/sw.js from src/sw.js with the list of built files to precache.
// Asset names are content-hashed by Vite, so the list has to be generated after each build.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const OUT = 'dist/client'
const SKIP = new Set(['sw.js', '_shell.html'])

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const files = walk(OUT)
  .map((p) => relative(OUT, p).split('\\').join('/'))
  .filter((f) => !SKIP.has(f) && !f.endsWith('.map'))
  .sort()

if (!files.includes('index.html')) throw new Error('build-sw: dist/client/index.html is missing')

const hash = createHash('sha256')
for (const f of files) hash.update(f).update(readFileSync(join(OUT, f)))
const buildHash = hash.digest('hex').slice(0, 10)

const assets = ['/', ...files.map((f) => '/' + f)]
const sw = readFileSync('src/sw.js', 'utf8')
  .replace('__BUILD_HASH__', buildHash)
  .replace('__PRECACHE__', JSON.stringify(assets))
writeFileSync(join(OUT, 'sw.js'), sw)
console.log(`build-sw: ${assets.length} files precached, cache milk-tracker-${buildHash}`)
