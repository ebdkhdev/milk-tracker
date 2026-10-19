// Backup reminder: shown for old data without a recent export, snoozed by "Later", cleared by exporting.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'

const pad = (n) => String(n).padStart(2, '0')
const day = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const KEY = 'suivi-lait-backup-v1'

export async function run(DIST) {
  suite('Backup reminder')
  const srv = await serve(DIST)
  const b = await launch()
  const dir = mkdtempSync(join(tmpdir(), 'milk-tracker-reminder-'))
  const setState = (state) => b.ev(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(state))})`)
  const ago = (days) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()
  try {
    await b.goto(srv.url)
    await b.ev(`localStorage.setItem("suivi-lait-lang-v1","fr")`)
    await b.reload()
    await b.click('#quick-grid button', 0); await sleep(200)
    check('no reminder for recent data', !(await b.exists('#backup-reminder')))

    // a bottle 20 days ago and no export yet
    const old = new Date(Date.now() - 20 * 24 * 3600 * 1000)
    const file = join(dir, 'old.json')
    writeFileSync(file, JSON.stringify({ app: 'milk-tracker', version: 1, daily: [], feeds: [{ id: 'old', date: day(old), ml: 90, time: old.toISOString() }] }))
    await b.click('#settings-btn')
    await b.setFiles('#import-file', [file])
    await b.waitFor(`!!document.getElementById("backup-reminder")`)
    equal('reminder without any export', await b.text('#backup-reminder span'), "Pense à exporter tes données : c'est la seule copie en dehors de ce téléphone.")

    await b.click('#backup-later'); await sleep(100)
    check('"Later" hides it', !(await b.exists('#backup-reminder')))
    await b.reload()
    check('still snoozed after reload', !(await b.exists('#backup-reminder')))
    await setState({ last: null, snoozeUntil: ago(1) })
    await b.reload()
    check('back when the snooze is over', await b.exists('#backup-reminder'))

    await b.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir })
    await b.click('#backup-now'); await sleep(500)
    check('exporting clears it', !(await b.exists('#backup-reminder')))
    check('export date recorded', !!JSON.parse(await b.ev(`localStorage.getItem(${JSON.stringify(KEY)})`)).last)

    await setState({ last: ago(40), snoozeUntil: null })
    await b.reload()
    equal('reminder 40 days after the last export', await b.text('#backup-reminder span'), 'Pense à exporter tes données : dernière sauvegarde il y a 40 jours.')
    await setState({ last: ago(10), snoozeUntil: null })
    await b.reload()
    check('no reminder 10 days after an export', !(await b.exists('#backup-reminder')))
    equal('no JS errors', b.errors, [])
  } finally {
    await b.close()
    await srv.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}
