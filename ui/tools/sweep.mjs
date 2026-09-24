// Visit every screen as the right role against a running server and report status + runtime errors.
//   APP_URL=http://localhost:3001 node ui/tools/sweep.mjs     → screenshots in ui/tools/out/sweep/
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import mongoose from 'mongoose'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.join(here, 'out', 'sweep')
fs.mkdirSync(out, { recursive: true })
const BASE = process.env.APP_URL ?? 'http://localhost:3000'
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p))

// real ids from the database
const env = Object.fromEntries(fs.readFileSync(path.resolve(here, '../../.env.local'), 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
await mongoose.connect(env.MONGODB_URI)
const db = mongoose.connection.db
const req = async (q) => String((await db.collection('homecare_requests').findOne(q, { sort: { scheduledAt: -1 } }))?._id)
const live = await req({ status: 'IN_PROGRESS' })
const completed = await req({ status: 'COMPLETED' })
const confirmed = await req({ status: 'CONFIRMED', 'patientSnapshot.name': 'Nur Mohammad' })
const assigned = await req({ status: 'ASSIGNED' })
const patient = String((await db.collection('patients').findOne({ name: 'Abdul Karim' }))._id)
const plan = String((await db.collection('care_plans').findOne({}))._id)
const trip = await req({ 'transport.needed': true, status: 'CONFIRMED' })
await mongoose.disconnect()

const WEB = [
  ['N-0100', ['/dashboard', '/dashboard?density=compact', '/requests', '/requests?view=table', '/requests/new', `/requests/${live}`, `/requests/${live}?tab=timeline`, `/requests/${live}?tab=assignment`, `/requests/${live}?tab=visit`, `/requests/${live}?tab=messages`, `/requests/${live}?tab=attachments`, `/requests/${live}?tab=audit`, `/requests/${confirmed}?assign=1`, `/print/report/${completed}`, '/search?q=Karim', '/patients', `/patients/${patient}`, '/staff', '/messages', '/notifications', '/reports', '/settings', '/settings/services', '/settings/fleet', '/settings/zones', '/settings/approvals', '/settings/templates', '/settings/notifications', '/audit', '/account']],
  ['A-0001', ['/settings/designations', '/settings/roles']],
  ['V-0301', ['/dashboard', '/reports']],
]
const APP = [
  ['11432', ['/m', '/m/visits', `/m/visits/${live}`, `/m/visits/${live}/checklist`, `/m/visits/${live}/vitals`, `/m/visits/${live}/notes`, `/m/visits/${live}/photos`, `/m/visits/${live}/confirm`, `/m/visits/${live}/checkout`, `/m/visits/${live}/chat`, `/m/visits/${live}/change`, '/m/notifications', '/m/profile', '/m/help', '/m/new-request', '/m/notes', '/m/route']],
  ['11289', [`/m/visits/${live}/rx`]],
  ['N-0210', [`/m/visits/${assigned}`]],
  ['N-0100', ['/m/admin', '/m/admin/inbox', '/m/admin/patients', `/m/admin/requests/${confirmed}`, `/m/admin/requests/${confirmed}/confirm`, `/m/admin/requests/${confirmed}/assign`, `/m/admin/requests/${completed}/close`, `/m/care-plans/${plan}`, '/m/care-plans/new']],
  ['T-0031', ['/m/trips', `/m/trips/${trip}/assign-car`, '/m/fleet']],
  ['D-0041', ['/m/trips', '/m/vehicle']],
]

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const results = []
// ONLY=N-0100:web,11432:app limits the sweep to those logins. Logins retry through network blips.
const ONLY = process.env.ONLY?.split(',')
async function login(who, client) {
  let r
  for (let i = 0; i < 4; i++) {
    r = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: who, password: 'Unico@2026', client }) })
    if (r.status < 500) return r
    await new Promise((res) => setTimeout(res, 3000))
  }
  return r
}
async function run(who, client, paths) {
  if (ONLY && !ONLY.includes(`${who}:${client}`)) return
  const r = await login(who, client)
  if (!r.ok) return results.push({ who, path: '(login)', status: r.status, errors: [await r.text()] })
  const token = r.headers.get('set-cookie').split(';')[0].split('=').slice(1).join('=')
  const page = await browser.newPage()
  await page.setViewport(client === 'app' ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1440, height: 900 })
  await page.setCookie({ name: 'hc_session', value: token, domain: 'localhost', path: '/', httpOnly: true })
  for (const p of paths) {
    const errors = []
    const onErr = (e) => errors.push(`pageerror: ${e.message}`)
    const onCon = (m) => m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 409/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 200)}`)
    page.on('pageerror', onErr)
    page.on('console', onCon)
    const t = Date.now()
    let status = 0
    try {
      const resp = await page.goto(BASE + p, { waitUntil: 'networkidle2', timeout: 60000 })
      status = resp?.status() ?? 0
      const body = await page.evaluate(() => document.body.innerText)
      if (/Application error|Internal Server Error|This page could not be found/.test(body)) errors.push('page shows: ' + body.slice(0, 160).replace(/\s+/g, ' '))
      const final = new URL(page.url()).pathname + new URL(page.url()).search
      if (final !== p) errors.push(`redirected to ${final}`)
      await page.screenshot({ path: path.join(out, `${who}_${p.replace(/[^\w]+/g, '_').slice(0, 60)}.png`) })
    } catch (e) {
      errors.push(`navigation: ${e.message}`)
    }
    page.off('pageerror', onErr)
    page.off('console', onCon)
    results.push({ who, path: p, status, ms: Date.now() - t, errors })
  }
  await page.close()
}
for (const [who, paths] of WEB) await run(who, 'web', paths)
for (const [who, paths] of APP) await run(who, 'app', paths)
await browser.close()

let bad = 0
for (const r of results) {
  const ok = r.status === 200 && !r.errors.length
  if (!ok) bad++
  console.log(`${ok ? 'OK ' : 'ERR'} ${String(r.status).padEnd(4)} ${String(r.ms ?? '').padStart(5)}ms ${r.who.padEnd(7)} ${r.path}${r.errors.length ? '\n      ' + r.errors.join('\n      ') : ''}`)
}
console.log(`\n${results.length - bad}/${results.length} screens clean · screenshots in ${out}`)
