// Tiny test harness: named checks, collected failures, non-zero exit code from run.mjs.
export const results = []
let current = ''
export function suite(name) { current = name; console.log('\n' + name) }
export function check(name, ok, detail = '') {
  results.push({ suite: current, name, ok: !!ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? '\n      ' + detail : ''}`)
}
export function equal(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  check(name, ok, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
