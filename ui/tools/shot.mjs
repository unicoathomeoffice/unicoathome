// Screenshot a page of the RUNNING app (npm run dev on :3000) as a given user, and report runtime errors.
//   node ui/tools/shot.mjs <path> [--as N-0100] [--mobile] [--full] [--click "text"] [--anon]
//   node ui/tools/shot.mjs /dashboard
//   node ui/tools/shot.mjs /m/visits --as 11432 --mobile
// Output: ui/tools/out/app_<path>.png  (Read it to view). Password for seed users: Unico@2026
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'out')
fs.mkdirSync(outDir, { recursive: true })
const args = process.argv.slice(2)
// Git Bash rewrites '/login' to 'C:/Program Files/Git/login' — undo that
// and '/m/login' to 'M:/login'. (Or run with MSYS_NO_PATHCONV=1.)
const unmsys = (a) => a.replace(/^[A-Za-z]:\/.*?\/Git(?=\/)/, '').replace(/^([A-Za-z]):\/(?!Program)/, (_, d) => `/${d.toLowerCase()}/`)
const target = args.map(unmsys).find((a) => a.startsWith('/')) ?? '/dashboard'
const flag = (n) => args.includes(n)
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const mobile = flag('--mobile') || target === '/m' || target.startsWith('/m/') || target.startsWith('/m?')
const who = opt('--as') ?? (mobile ? '11432' : 'N-0100')
const BASE = process.env.APP_URL ?? 'http://localhost:3000'
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p))

const anon = flag('--anon')
const res = anon ? null : await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: who, password: 'Unico@2026', client: mobile ? 'app' : 'web' }) })
if (res && !res.ok) {
  console.error('login failed', res.status, await res.text())
  process.exit(1)
}
const token = anon ? null : res.headers.get('set-cookie').split(';')[0].split('=').slice(1).join('=')

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { width: 1440, height: 900 })
if (token) await page.setCookie({ name: 'hc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
const resp = await page.goto(BASE + target, { waitUntil: 'networkidle2', timeout: 90000 })
if (opt('--click')) {
  const txt = opt('--click')
  const el = await page.evaluateHandle((t) => [...document.querySelectorAll('button,a,[role=button]')].find((e) => e.textContent?.trim().includes(t)), txt)
  if (el.asElement()) {
    await el.asElement().click()
    await new Promise((r) => setTimeout(r, 1200))
  } else errors.push(`click target not found: ${txt}`)
}
const overlay = await page.evaluate(() => {
  const n = document.querySelector('nextjs-portal')
  const dev = n?.shadowRoot?.textContent ?? ''
  const body = document.body.innerText
  const m = dev.match(/(\d+ Issues?|Runtime Error|Build Error|Unhandled[^.]*)/)
  return (m ? 'Next.js dev overlay: ' + m[0] + ' · ' + dev.replace(/\s+/g, ' ').slice(0, 400) + ' ' : '') + (/Application error|Unhandled Runtime Error|Internal Server Error/.test(body) ? body.slice(0, 600) : '')
})
const file = path.join(outDir, `app_${target.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'root'}${mobile ? '_m' : ''}.png`)
await page.screenshot({ path: file, fullPage: flag('--full') })
console.log(`HTTP ${resp?.status()} · ${page.url()}`)
if (overlay) console.log('ERROR:', overlay)
for (const e of errors.slice(0, 10)) console.log(e)
console.log('PNG:', file)
await browser.close()
