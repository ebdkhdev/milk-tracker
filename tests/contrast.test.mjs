// WCAG contrast of every text colour on what it sits on, light and dark. Colours are read from src/styles.css,
// and the glass panels are checked against the real rendered backdrop (worst pixel), so a palette change is
// re-verified automatically.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, suite } from './lib/assert.mjs'
import { decodePng } from './lib/png.mjs'

const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8')

function block(selector) {
  const i = css.indexOf(selector + ' {')
  if (i < 0) throw new Error('no CSS block ' + selector)
  return css.slice(i, css.indexOf('}', i))
}
function tokens(text) {
  const out = {}
  for (const m of text.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}
// [r, g, b, a] from #rgb, #rrggbb or rgba()
function color(v) {
  if (!v) throw new Error('missing colour')
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1)
  }
  m = v.match(/^rgba?\(([^)]+)\)$/)
  if (m) { const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1] }
  throw new Error('unparsed colour ' + v)
}
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)) }
// CSS saturate() filter matrix
function saturate([r, g, b], s) {
  const m = [[0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]]
  return m.map((row) => Math.max(0, Math.min(255, row[0] * r + row[1] * g + row[2] * b)))
}

const light = tokens(block(':root'))
const dark = { ...light, ...tokens(block(':root[data-theme="dark"]')) }
const panelSat = Number((css.match(/\.card, \.total-card[^{]*\{[^}]*saturate\(([\d.]+)\)/) || [])[1] || 1)

function worst(name, fg, backgrounds, min) {
  let r = Infinity
  for (const bgc of backgrounds) r = Math.min(r, ratio(fg, bgc))
  check(`${name}: ${r.toFixed(2)}:1 (>= ${min})`, r >= min)
}

export async function run(DIST) {
  suite('Contrast (WCAG)')
  // backdrop pixels for each scheme: content hidden, three phone/tablet sizes
  const srv = await serve(DIST)
  const b = await launch()
  const backdrop = { light: [], dark: [] }
  try {
    await b.goto(srv.url)
    await b.ev(`document.querySelector(".wrap").style.visibility="hidden"`)
    for (const scheme of ['light', 'dark']) {
      await b.media({ 'prefers-color-scheme': scheme })
      const seen = new Set()
      for (const [w, h] of [[320, 568], [390, 844], [768, 1024]]) {
        await b.viewport(w, h); await sleep(300)
        const img = decodePng(await b.screenshot())
        // skip the top bar band and the overlay scrollbar on the right edge
        for (let y = 60; y < img.height; y += 2) for (let x = 0; x < img.width - 14; x += 2) {
          const p = img.pixel(x, y), k = p.join()
          if (!seen.has(k)) { seen.add(k); backdrop[scheme].push(p) }
        }
      }
    }
  } finally {
    await b.close()
    await srv.stop()
  }

  for (const [scheme, T] of [['light', light], ['dark', dark]]) {
    const c = (k) => color(T[k])
    const opaque = ['bg', 'surface', 'fill'].map(c)
    worst(`${scheme} label on opaque surfaces`, c('label'), opaque, 4.5)
    worst(`${scheme} label-2 on opaque surfaces`, c('label-2'), opaque, 4.5)
    worst(`${scheme} tint on opaque surfaces`, c('tint'), opaque, 4.5)
    worst(`${scheme} good on surface and fill`, c('good'), [c('surface'), c('fill')], 4.5)
    worst(`${scheme} warn on surface and fill`, c('warn'), [c('surface'), c('fill')], 4.5)
    worst(`${scheme} danger on surface`, c('danger'), [c('surface')], 4.5)
    worst(`${scheme} on-tint on tint`, c('on-tint'), [c('tint')], 4.5)

    const px = backdrop[scheme]
    check(`${scheme} backdrop sampled (${px.length} colours)`, px.length > 10)
    worst(`${scheme} label on backdrop`, c('label'), px, 4.5)
    worst(`${scheme} label-on-bg on backdrop`, c('label-on-bg'), px, 4.5)
    worst(`${scheme} tint glyph (chevron) on backdrop`, c('tint'), px, 3)
    const panels = px.map((p) => over(c('panel'), saturate(p, panelSat)))
    for (const k of ['label', 'label-2', 'tint', 'good', 'warn', 'danger']) worst(`${scheme} ${k} on glass panels`, c(k), panels, 4.5)

    // floating glass (top bar capsules, toast) over the largest coloured areas that can scroll beneath
    const under = ['bg', 'surface', 'fill', 'tint', 'good', 'warn'].map(c).concat(panels)
    worst(`${scheme} label on floating glass`, c('label'), under.map((u) => over(c('glass'), u)), 4.5)
  }
}
