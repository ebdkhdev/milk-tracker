// Minimal headless Chrome driver over the DevTools protocol, plus a static server for the built app.
// No dependencies: Node's fetch/WebSocket and a local Chrome (set CHROME_PATH if it is not found).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DEBUG_PORT = 9333

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ].filter(Boolean)
  for (const c of candidates) {
    if (c.startsWith('/')) { if (existsSync(c)) return c }
    else if (spawnSync('which', [c]).status === 0) return c
  }
  return null
}

// profile: reuse a directory to keep storage/service worker across launches (upgrade test)
export async function launch({ profile } = {}) {
  const chrome = findChrome()
  if (!chrome) throw new Error('Chrome not found: set CHROME_PATH')
  const dir = profile || mkdtempSync(join(tmpdir(), 'milk-tracker-test-'))
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' })
  const exited = new Promise((r) => proc.on('exit', r))
  let tabs
  for (let i = 0; i < 40 && !tabs; i++) {
    await sleep(250)
    try { tabs = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json() } catch (e) {}
  }
  if (!tabs) throw new Error('Chrome did not start')
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  let id = 0
  const pending = {}
  const errors = []
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id] }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value ?? a.description).join(' '))
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id
    pending[i] = (d) => (d.error ? reject(new Error(method + ': ' + d.error.message)) : resolve(d.result))
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  // Evaluates in the page; a page exception fails the test instead of coming back as a string.
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error('page error in ' + expr.slice(0, 80) + ': ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result.value
  }
  await send('Runtime.enable')
  await send('Page.enable')
  await viewport(send, 390, 844)
  // Browser.close lets Chrome flush localStorage to disk (a plain kill can lose recent writes)
  const close = async () => {
    send('Browser.close').catch(() => {})
    const timer = setTimeout(() => proc.kill(), 5000)
    await exited
    clearTimeout(timer)
    ws.close()
    // wait until the debugging port is free for the next launch
    for (let i = 0; i < 20; i++) {
      try { await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`); await sleep(250) } catch (e) { break }
    }
    if (!profile) rmSync(dir, { recursive: true, force: true })
  }
  const page = makePage(send, ev)
  return { send, ev, errors, close, ...page }
}

function viewport(send, width, height, scale = 1) {
  return send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: true })
}

function makePage(send, ev) {
  const q = (sel) => JSON.stringify(sel)
  return {
    viewport: (w, h, s) => viewport(send, w, h, s),
    goto: async (url) => { await send('Page.navigate', { url }); await waitFor(ev, `!!document.getElementById("total-number")`) },
    reload: async () => { await send('Page.reload'); await sleep(300); await waitFor(ev, `!!document.getElementById("total-number")`) },
    click: (sel, i = 0) => ev(`(function(){var e=document.querySelectorAll(${q(sel)})[${i}]; if(!e) throw new Error("no element " + ${q(sel)}); e.click()})()`),
    text: (sel) => ev(`(function(){var e=document.querySelector(${q(sel)}); return e ? e.textContent : null})()`),
    exists: (sel) => ev(`!!document.querySelector(${q(sel)})`),
    count: (sel) => ev(`document.querySelectorAll(${q(sel)}).length`),
    // sets a React-controlled input/select value and fires the events React listens to
    setValue: (sel, v) => ev(`(function(){var e=document.querySelector(${q(sel)});
      var proto=e.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,"value").set.call(e,${q(v)});
      e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true}));})()`),
    waitFor: (expr, ms) => waitFor(ev, expr, ms),
    media: (features) => send('Emulation.setEmulatedMedia', { features: Object.entries(features).map(([name, value]) => ({ name, value })) }),
    screenshot: async (clip) => Buffer.from((await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })).data, 'base64'),
  }
}

export async function waitFor(ev, expr, ms = 5000) {
  const end = Date.now() + ms
  for (;;) {
    let ok = false
    try { ok = await ev(expr) } catch (e) {}
    if (ok) return
    if (Date.now() > end) throw new Error('timed out waiting for ' + expr)
    await sleep(50)
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
}

// Like Vercel for this app: everything revalidates, and no conditional 304s (tests swap directories).
// dir can be changed while running (upgrade test); stop() also simulates going offline.
export async function serve(dir, port = 8765) {
  const state = { dir }
  const server = createServer((req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '')
    let file = join(state.dir, path)
    if (path.endsWith('/') || !existsSync(file) || statSync(file).isDirectory()) {
      file = existsSync(file) && statSync(file).isDirectory() ? join(file, 'index.html') : file
    }
    if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=0, must-revalidate' })
    res.end(readFileSync(file))
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const sockets = new Set()
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  return {
    url: `http://127.0.0.1:${port}/`,
    setDir: (d) => { state.dir = d },
    stop: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); server.close(() => r()) }),
  }
}
