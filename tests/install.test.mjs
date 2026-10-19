// iPhone install hint: shown in Safari on iOS (Safari has no install prompt), dismissable, hidden elsewhere.
import { launch, serve, sleep } from './lib/browser.mjs'
import { check, equal, suite } from './lib/assert.mjs'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'

export async function run(DIST) {
  suite('Install hint on iOS')
  const srv = await serve(DIST)
  for (const [name, ua, touch, expected] of [['iPhone', IPHONE, 5, true], ['iPad (reports Mac)', IPAD, 5, true], ['Mac', IPAD, 0, false]]) {
    const b = await launch()
    try {
      await b.send('Emulation.setUserAgentOverride', { userAgent: ua })
      await b.send('Emulation.setTouchEmulationEnabled', { enabled: touch > 0, maxTouchPoints: touch || 1 })
      await b.goto(srv.url)
      equal(`${name}: hint ${expected ? 'shown' : 'hidden'}`, await b.exists('#ios-install-hint'), expected)
      if (expected) {
        await b.click('#ios-hint-close'); await sleep(100)
        check(`${name}: dismiss hides it`, !(await b.exists('#ios-install-hint')))
        await b.reload()
        check(`${name}: stays dismissed after reload`, !(await b.exists('#ios-install-hint')))
      }
      equal(`${name}: no JS errors`, b.errors, [])
    } finally {
      await b.close()
    }
  }
  await srv.stop()
}
