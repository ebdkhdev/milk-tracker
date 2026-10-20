// Builds a released version of the app (a git tag) once, for tests that mix old and new phones.
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function buildTag(tag) {
  const dir = join(tmpdir(), 'milk-tracker-build-' + tag)
  const dist = join(dir, 'dist', 'client')
  if (existsSync(join(dist, 'index.html'))) return dist
  mkdirSync(dir, { recursive: true })
  execSync(`git archive ${tag} | tar -x -C "${dir}"`, { stdio: ['ignore', 'ignore', 'pipe'] })
  execSync('npm ci --no-audit --no-fund && npm run build', { cwd: dir, stdio: 'ignore' })
  return dist
}
