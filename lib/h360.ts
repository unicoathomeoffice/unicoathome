import 'server-only'
import { parse, type HTMLElement } from 'node-html-parser'
import { IntegrationSecret, Setting } from './models'
import { decryptIntegration, encryptIntegration } from './integration-secrets'
import { forget, memo } from './memo'

// Connector to the hospital HIS "H360" (his.unicohospitals.com, Laravel / PHP). The login is saved by a super admin in
// Settings → Integrations (encrypted, never sent back to the browser). We sign in like a browser (CSRF token + session
// cookie), keep the session for ~9 h, and read the Patient List search. Read-only: nothing is ever written to H360.

export type H360Config = { baseUrl: string; username: string; password: string }
export type H360Patient = { uhid: string; name: string; dob?: string; ageYears?: number; gender?: string; ageGender?: string; company?: string; phone?: string; altPhone?: string; email?: string; address?: string; guardianName?: string; regType?: string; category?: string }

const AAD = 'h360:v1'
const TIMEOUT = 10_000
const UA = 'Mozilla/5.0 (UnicoHomeCare connector)'
export const DEFAULT_H360_URL = 'https://his.unicohospitals.com'

export class H360Error extends Error {
  constructor(public code: 'NOT_CONFIGURED' | 'AUTH' | 'DOWN' | 'PARSE', message: string) {
    super(message)
  }
}

// ---------------------------------------------------------------- saved logins
// Two H360 logins, each saved encrypted by a super admin (Settings → Integrations → H360) and changeable any time:
//   main  — patients, bills, staff search, tests catalog
//   store — the Family Medicine store (Sub Store Stock Ledger); falls back to main when not saved
export type H360Profile = 'main' | 'store'
const KEY: Record<H360Profile, { cfg: string; session: string; status: string }> = {
  main: { cfg: 'h360', session: 'h360:session', status: 'h360:status' },
  store: { cfg: 'h360:store', session: 'h360:store:session', status: 'h360:store:status' },
}

/** The login saved for exactly this profile (no fallback) — for the settings card. */
export async function ownConfig(profile: H360Profile): Promise<H360Config | null> {
  const row = await IntegrationSecret.findById(KEY[profile].cfg).select('+encrypted').lean<any>()
  return row ? decryptIntegration<H360Config>(row.encrypted, AAD) : null
}
/** The login for a profile — the store login falls back to the main one when it isn't saved. */
export async function getH360Config(profile: H360Profile = 'main'): Promise<H360Config | null> {
  return (await ownConfig(profile)) ?? (profile === 'store' ? ownConfig('main') : null)
}
/** Which saved login a profile really uses (store → main when the store login isn't saved). */
async function effective(profile: H360Profile): Promise<H360Profile> {
  return profile === 'store' && !(await IntegrationSecret.exists({ _id: KEY.store.cfg })) ? 'main' : profile
}
export async function saveH360Config(c: H360Config, userId: string, profile: H360Profile = 'main') {
  await IntegrationSecret.updateOne({ _id: KEY[profile].cfg }, { encrypted: encryptIntegration(c, AAD), updatedBy: userId }, { upsert: true })
  await IntegrationSecret.deleteOne({ _id: KEY[profile].session })
  jars.delete(profile)
}
export async function clearH360Config(profile: H360Profile = 'main') {
  await IntegrationSecret.deleteMany({ _id: { $in: [KEY[profile].cfg, KEY[profile].session] } })
  jars.delete(profile)
}
/** last test / login result, for the settings card (no secrets) */
export async function h360Status(profile: H360Profile = 'main') {
  const [cfg, st] = await Promise.all([IntegrationSecret.findById(KEY[profile].cfg).select('updatedAt updatedBy').lean<any>(), Setting.findOne({ key: KEY[profile].status }).lean<any>()])
  return { configured: !!cfg, savedAt: cfg?.updatedAt ?? null, ...(st?.value ?? {}) } as { configured: boolean; savedAt: Date | null; ok?: boolean; at?: Date; error?: string; username?: string; baseUrl?: string; found?: number | null }
}
async function setStatus(v: Record<string, unknown>, profile: H360Profile = 'main') {
  await Setting.updateOne({ key: KEY[profile].status }, { value: { ...v, at: new Date() } }, { upsert: true })
}

// ---------------------------------------------------------------- cookie jar + sign-in
type Jar = { base: string; cookies: Record<string, string>; until: number }
const jars = new Map<H360Profile, Jar>()
const signingIn = new Map<H360Profile, Promise<Jar>>()

const cookieHeader = (j: Jar) => Object.entries(j.cookies).map(([k, v]) => `${k}=${v}`).join('; ')
function absorb(j: Jar, res: Response) {
  const list = (res.headers as any).getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : [])
  for (const c of list) {
    const [pair] = c.split(';')
    const i = pair.indexOf('=')
    if (i > 0) j.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim()
  }
}
async function raw(j: Jar, path: string, init: RequestInit = {}) {
  const url = path.startsWith('http') ? path : `${j.base}${path}`
  let res: Response
  try {
    // an extra `cookie` header (e.g. H360's menu_id) is added to the session cookies, not swapped for them
    const { cookie: extra, ...headers } = (init.headers ?? {}) as Record<string, string>
    res = await fetch(url, { ...init, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT), headers: { 'user-agent': UA, accept: 'text/html,application/json;q=0.9,*/*;q=0.8', cookie: [cookieHeader(j), extra].filter(Boolean).join('; '), ...headers } })
  } catch (e: any) {
    throw new H360Error('DOWN', `H360 did not answer (${e?.name === 'TimeoutError' ? 'timeout' : e?.message ?? 'network error'})`)
  }
  absorb(j, res)
  return res
}
const isLoginRedirect = (res: Response) => res.status >= 300 && res.status < 400 && /\/login\b/.test(res.headers.get('location') ?? '')

async function signIn(profile: H360Profile = 'main'): Promise<Jar> {
  const cfg = await ownConfig(profile)
  if (!cfg) throw new H360Error('NOT_CONFIGURED', 'H360 login is not set — a super admin can add it in Settings → Integrations')
  const j: Jar = { base: cfg.baseUrl.replace(/\/+$/, ''), cookies: {}, until: 0 }
  const page = await raw(j, '/login')
  const html = await page.text()
  const token = parse(html).querySelector('input[name="_token"]')?.getAttribute('value')
  if (!token) throw new H360Error('PARSE', 'H360 login page changed (no CSRF token found)')
  const res = await raw(j, '/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', referer: `${j.base}/login`, origin: j.base }, body: new URLSearchParams({ _token: token, email: cfg.username, password: cfg.password }).toString() })
  const to = res.headers.get('location') ?? ''
  if (res.status === 419) throw new H360Error('AUTH', 'H360 refused the sign-in (session token expired) — try again')
  if (!(res.status >= 300 && res.status < 400) || /\/login\b/.test(to)) {
    await setStatus({ ok: false, error: 'H360 login failed — check the user name and password', username: cfg.username, baseUrl: j.base }, profile)
    throw new H360Error('AUTH', `H360 ${profile === 'store' ? 'store ' : ''}login failed — check the user name and password in Settings → Integrations`)
  }
  if (to) await raw(j, to) // land on the dashboard so the session is fully set
  j.until = Date.now() + 9 * 3600_000
  await IntegrationSecret.updateOne({ _id: KEY[profile].session }, { encrypted: encryptIntegration(j, AAD) }, { upsert: true })
  return j
}

async function session(fresh = false, profile: H360Profile = 'main'): Promise<Jar> {
  const cur = jars.get(profile)
  if (!fresh && cur && cur.until > Date.now()) return cur
  if (!fresh) {
    const row = await IntegrationSecret.findById(KEY[profile].session).select('+encrypted').lean<any>()
    if (row) {
      try {
        const j = decryptIntegration<Jar>(row.encrypted, AAD)
        if (j.until > Date.now()) {
          jars.set(profile, j)
          return j
        }
      } catch {}
    }
  }
  let p = signingIn.get(profile)
  if (!p) {
    p = signIn(profile).finally(() => signingIn.delete(profile))
    signingIn.set(profile, p)
  }
  const j = await p
  jars.set(profile, j)
  return j
}

/** GET/POST inside H360 (as the given login), signing in again once if the session has expired. */
export async function h360(path: string, init: RequestInit = {}, as: H360Profile = 'main') {
  const profile = await effective(as)
  let j = await session(false, profile)
  let res = await raw(j, path, init)
  if (isLoginRedirect(res) || res.status === 401 || res.status === 419) {
    j = await session(true, profile)
    res = await raw(j, path, init)
  }
  if (isLoginRedirect(res)) throw new H360Error('AUTH', 'H360 session could not be opened')
  return res
}

// ---------------------------------------------------------------- patient list
const PATIENT_LIST = '/uhl/patient-list'
type Form = { action: string; method: string; fields: Record<string, string>; names: string[] }
type ListMeta = { form: Form | null; ajax: string | null; headers: string[]; csrf: string | null }

const text = (el?: HTMLElement | null) => (el?.text ?? '').replace(/\s+/g, ' ').trim()

/** Read the Patient List page once per instance (10 min): its search form, any DataTables AJAX URL, column headers. */
function listMeta() {
  return memo('h360:patient-list-meta', 10 * 60_000, async (): Promise<ListMeta> => {
    const res = await h360(PATIENT_LIST)
    const html = await res.text()
    const doc = parse(html)
    const csrf = doc.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? doc.querySelector('input[name="_token"]')?.getAttribute('value') ?? null
    // the form holding the "Mobile" / "UHID" inputs
    let form: Form | null = null
    for (const f of doc.querySelectorAll('form')) {
      const inputs = f.querySelectorAll('input, select')
      const names = inputs.map((i) => i.getAttribute('name')).filter(Boolean) as string[]
      if (!names.some((n) => /uhid|mobile|phone|name/i.test(n))) continue
      const fields: Record<string, string> = {}
      for (const i of inputs) {
        const n = i.getAttribute('name')
        if (!n) continue
        if (i.tagName === 'SELECT') fields[n] = i.querySelector('option[selected]')?.getAttribute('value') ?? i.querySelector('option')?.getAttribute('value') ?? ''
        else fields[n] = i.getAttribute('value') ?? ''
      }
      form = { action: f.getAttribute('action') || PATIENT_LIST, method: (f.getAttribute('method') || 'GET').toUpperCase(), fields, names }
      break
    }
    // DataTables / jQuery ajax URL used to load the table
    const scripts = doc.querySelectorAll('script').map((s) => s.text).join('\n')
    const ajax = scripts.match(/ajax\s*:\s*\{[^}]*?url\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] ?? scripts.match(/ajax\s*:\s*["'`]([^"'`]+)["'`]/)?.[1] ?? scripts.match(/url\s*:\s*["'`]([^"'`]*patient[^"'`]*)["'`]/i)?.[1] ?? null
    const headers = doc.querySelectorAll('table thead th').map((th) => text(th))
    return { form, ajax, headers, csrf }
  })
}

/** Which form field takes which kind of query (by its name). */
function fieldFor(names: string[], kind: 'mobile' | 'uhid' | 'name') {
  if (kind === 'mobile') return names.find((n) => /mobile|phone|contact/i.test(n))
  if (kind === 'uhid') return names.find((n) => /uhid/i.test(n)) ?? names.find((n) => /name/i.test(n))
  return names.find((n) => /name/i.test(n) && !/user/i.test(n)) ?? names.find((n) => /uhid/i.test(n))
}

const HEAD_KEY: [RegExp, keyof H360Patient][] = [
  [/uhid/i, 'uhid'],
  [/patient\s*name|^name$/i, 'name'],
  [/^dob|birth/i, 'dob'],
  [/age|gender|sex/i, 'ageGender'],
  [/company|corporate/i, 'company'],
  [/mobile|phone/i, 'phone'],
  [/address/i, 'address'],
  [/guardian/i, 'guardianName'],
  [/reg/i, 'regType'],
]
function toPatient(cells: string[], headers: string[]): H360Patient | null {
  const p: any = {}
  headers.forEach((h, i) => {
    const key = HEAD_KEY.find(([rx]) => rx.test(h))?.[1]
    if (key && cells[i] != null && p[key] == null) p[key] = cells[i]
  })
  if (!p.uhid && !p.name) return null
  const ag = String(p.ageGender ?? '')
  const age = ag.match(/(\d{1,3})\s*Y/i)?.[1] ?? ag.match(/^(\d{1,3})\b/)?.[1]
  if (age) p.ageYears = Number(age)
  p.gender = /\bF(emale)?\b/i.test(ag) ? 'F' : /\bM(ale)?\b/i.test(ag) ? 'M' : undefined
  for (const k of Object.keys(p)) if (typeof p[k] === 'string') p[k] = p[k].trim()
  if (p.phone) p.phone = p.phone.replace(/[^\d+]/g, '')
  return p as H360Patient
}

function rowsFromHtml(html: string, fallbackHeaders: string[]) {
  const doc = parse(html)
  const table = doc.querySelectorAll('table').find((t) => t.querySelectorAll('tbody tr').length) ?? doc.querySelector('table')
  if (!table) return []
  const headers = table.querySelectorAll('thead th').map((th) => text(th))
  const hs = headers.length ? headers : fallbackHeaders
  return table
    .querySelectorAll('tbody tr')
    .map((tr) => toPatient(tr.querySelectorAll('td').map((td) => text(td)), hs))
    .filter((x): x is H360Patient => !!x)
}

// The "UHID / Name" and "Mobile #" boxes on H360's Patient List are typeahead fields that POST `search_data` to
// /patient-info-autocomplete (Laravel, CSRF token from the page) and get JSON rows back — UHID, phone or name.
const AUTOCOMPLETE = '/patient-info-autocomplete'

/** CSRF token for H360's AJAX calls, read from a page's <meta name="csrf-token"> (30 min, renewed on 419). */
function csrfToken() {
  return memo('h360:csrf', 30 * 60_000, async () => {
    const res = await h360(PATIENT_LIST)
    const doc = parse(await res.text())
    const t = doc.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? doc.querySelector('input[name="_token"]')?.getAttribute('value')
    if (!t) throw new H360Error('PARSE', 'H360 page has no CSRF token')
    return t
  })
}

const str = (v: unknown) => (v == null ? '' : String(v).trim())
/** One row of H360's autocomplete → our patient shape. */
function fromAutocomplete(it: any): H360Patient | null {
  const uhid = str(it.patient_code)
  const name = str(it.patient_name)
  if (!uhid && !name) return null
  const g = str(it.gender)
  const gender = /^f/i.test(g) ? 'F' : /^m/i.test(g) ? 'M' : g ? 'O' : undefined
  const yy = Number(it.age_yy)
  const ageYears = Number.isFinite(yy) && str(it.age_yy) !== '' ? yy : Number(str(it.pat_age).match(/^(\d{1,3})/)?.[1]) || undefined
  return {
    uhid,
    name,
    category: str(it.patient_type_code) || undefined,
    regType: str(it.patient_type_code) || undefined,
    gender,
    ageYears,
    ageGender: [str(it.pat_age).replace(/\s+0 D$/, ''), g].filter(Boolean).join(' · ') || undefined,
    dob: str(it.dob) || undefined,
    phone: str(it.phone_mobile).replace(/[^\d+]/g, '') || undefined,
    altPhone: str(it.alt_phone_mobile).replace(/[^\d+]/g, '') || undefined,
    email: /@/.test(str(it.email)) ? str(it.email) : undefined,
    company: str(it.ccm_client_name) || undefined,
    guardianName: str(it.spouse_name) || str(it.contact_person) || undefined,
    address: [str(it.pr_addr_thana), str(it.present_district)].filter(Boolean).join(', ') || undefined,
  }
}

async function autocomplete(term: string, retry = true): Promise<H360Patient[] | null> {
  const token = await csrfToken()
  const res = await h360(AUTOCOMPLETE, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-csrf-token': token, 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' },
    body: new URLSearchParams({ search_data: term }).toString(),
  })
  if ((res.status === 419 || res.status === 401) && retry) {
    forget('h360:csrf') // token from an older session
    return autocomplete(term, false)
  }
  if (res.status === 404) return null // this H360 has no autocomplete endpoint → use the list fallback
  if (!res.ok) throw new H360Error('DOWN', `H360 search answered ${res.status}`)
  const body = await res.text()
  try {
    const json = JSON.parse(body)
    const rows: any[] = Array.isArray(json) ? json : json.data ?? []
    return rows.map(fromAutocomplete).filter((x): x is H360Patient => !!x)
  } catch {
    throw new H360Error('PARSE', 'H360 search did not return a patient list')
  }
}

/** Live search in H360 by UHID, mobile number or name (min. 3 characters). Max 10 results, cached 60 s. */
export async function searchPatients(q: string): Promise<H360Patient[]> {
  const term = q.trim()
  if (term.length < 3) return []
  return memo(`h360:pat:${term.toLowerCase()}`, 60_000, async () => {
    const digits = term.replace(/\D/g, '')
    // phone numbers as H360 stores them (01XXXXXXXXX), whatever the user typed (+880 …, spaces)
    const query = digits.length >= 10 && digits.length === term.replace(/[\s+()-]/g, '').length ? `0${digits.slice(-10)}` : term
    const hits = await autocomplete(query)
    if (hits) return hits.slice(0, 10)
    return (await searchPatientsByList(term)).slice(0, 10)
  })
}

/** Fallback: read the Patient List page's DataTables endpoint or search form (older H360 layouts). */
async function searchPatientsByList(q: string): Promise<H360Patient[]> {
  const term = q.trim()
  if (term.length < 3) return []
  return memo(`h360:pat:${term.toLowerCase()}`, 60_000, async () => {
    const meta = await listMeta()
    const digits = term.replace(/\D/g, '')
    const kind = digits.length >= 10 && digits.length === term.replace(/[\s+-]/g, '').length ? 'mobile' : /^\d+$/.test(term) ? 'uhid' : 'name'
    const value = kind === 'mobile' ? digits.slice(-11) : term

    // 1) DataTables endpoint (JSON)
    if (meta.ajax) {
      const field = fieldFor(meta.form?.names ?? [], kind)
      const params = new URLSearchParams({ ...(meta.form?.fields ?? {}), draw: '1', start: '0', length: '10', 'search[value]': field ? '' : value, ...(field ? { [field]: value } : {}) })
      const res = await h360(`${meta.ajax}${meta.ajax.includes('?') ? '&' : '?'}${params}`, { headers: { 'x-requested-with': 'XMLHttpRequest', accept: 'application/json', ...(meta.csrf ? { 'x-csrf-token': meta.csrf } : {}) } })
      const body = await res.text()
      try {
        const json = JSON.parse(body)
        const data: any[] = json.data ?? json.aaData ?? (Array.isArray(json) ? json : [])
        const out = data
          .map((row) => {
            if (Array.isArray(row)) return toPatient(row.map((c) => text(parse(String(c ?? '')))), meta.headers)
            const p: any = {}
            for (const [k, v] of Object.entries(row)) {
              const key = HEAD_KEY.find(([rx]) => rx.test(k.replace(/_/g, ' ')))?.[1]
              if (key && p[key] == null) p[key] = text(parse(String(v ?? '')))
            }
            return toPatient(Object.values(p) as string[], Object.keys(p)) ?? (p.uhid || p.name ? p : null)
          })
          .filter(Boolean) as H360Patient[]
        if (out.length || !meta.form) return out.slice(0, 10)
      } catch {
        if (/<table/i.test(body)) return rowsFromHtml(body, meta.headers).slice(0, 10)
      }
    }

    // 2) submit the search form and read the table
    if (!meta.form) throw new H360Error('PARSE', 'H360 Patient List page changed (no search form found)')
    const field = fieldFor(meta.form.names, kind)
    if (!field) throw new H360Error('PARSE', 'H360 Patient List has no UHID / mobile field')
    const params = new URLSearchParams({ ...meta.form.fields, [field]: value })
    const res =
      meta.form.method === 'POST'
        ? await h360(meta.form.action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() })
        : await h360(`${meta.form.action}${meta.form.action.includes('?') ? '&' : '?'}${params}`)
    return rowsFromHtml(await res.text(), meta.headers).slice(0, 10)
  })
}

/** Settings → Integrations → Test connection: sign in, read the Patient List page, optionally run one search. */
export async function testH360(sample?: string) {
  const cfg = await getH360Config()
  try {
    jars.delete('main')
    forget('h360:')
    await IntegrationSecret.deleteOne({ _id: KEY.main.session })
    await session(true)
    await csrfToken()
    let found: number | null = null
    let first: string | null = null
    if (sample) {
      const hits = await searchPatients(sample)
      found = hits.length
      first = hits[0] ? `${hits[0].name} · UHID ${hits[0].uhid}` : null
    }
    await setStatus({ ok: true, username: cfg?.username, baseUrl: cfg?.baseUrl, error: null })
    return { ok: true, endpoint: AUTOCOMPLETE, found, first }
  } catch (e: any) {
    await setStatus({ ok: false, username: cfg?.username, baseUrl: cfg?.baseUrl, error: e?.message ?? String(e) })
    return { ok: false, error: e?.message ?? String(e) }
  }
}

// ---------------------------------------------------------------- bills (Billing List + printed bill copy)
// H360's Billing List (menu 57) is a DataTables table fed by POST /search-bill-list (invoice_id, hdn_patient_id = H360's
// patient key, date_from/date_to dd-mm-yyyy). Each row is an array; the column meaning comes from H360's own render code:
// 1 invoice · 3 billed at · 4 UHID · 5 name · 7 mobile · 14 paid · 15 due · 16 refund · 25 discount · 26 gross ·
// 32 bill type · 33 TRX ids · 34 sales cancel · 35 total bill. The bill copy is a PDF at /bill-invoice-app-print-v2/:id/1/:trx.

export type H360Bill = { invoiceNo: string; at: string | null; uhid: string; name: string; phone: string; total: number; discount: number; payable: number; paid: number; due: number; refund: number; type: string; trx: string[] }

const BILL_MENU = 'menu_id=57'
const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
const dmy = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d).replace(/\//g, '-')

function toBill(row: any[]): H360Bill | null {
  const invoiceNo = str(row[1] ?? row[0])
  if (!invoiceNo) return null
  const total = num(row[35]) || num(row[26])
  const discount = num(row[25])
  const cancel = num(row[34])
  const at = str(row[3])
  return {
    invoiceNo,
    at: at ? new Date(`${at.replace(' ', 'T')}+06:00`).toISOString() : null,
    uhid: str(row[4]),
    name: str(row[5]),
    phone: str(row[7]),
    total,
    discount,
    payable: Math.max(0, total - cancel - discount),
    paid: num(row[14]),
    due: Math.max(0, num(row[15])),
    refund: num(row[16]),
    type: str(row[32]),
    trx: [...new Set(str(row[33]).split(/,\s*/).filter(Boolean))],
  }
}

/** Billing-list CSRF token (the list page's own form token; 30 min, renewed on 419). */
function billToken() {
  return memo('h360:bill-csrf', 30 * 60_000, async () => {
    const html = await (await h360('/billing', { headers: { 'x-requested-with': 'XMLHttpRequest', cookie: BILL_MENU } })).text()
    const t = html.match(/name="_token" value="([^"]+)"/)?.[1] ?? html.match(/_token:\s*"([^"]+)"/)?.[1]
    if (!t) throw new H360Error('PARSE', 'H360 Billing List page changed (no CSRF token found)')
    return t
  })
}

/** H360's internal patient key for a UHID (needed to list one patient's bills). */
export async function patientKey(uhid: string): Promise<string | null> {
  if (!uhid) return null
  return memo(`h360:pk:${uhid}`, 24 * 3600_000, async () => {
    const token = await csrfToken()
    const res = await h360(AUTOCOMPLETE, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-csrf-token': token, 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' }, body: new URLSearchParams({ search_data: uhid }).toString() })
    if (!res.ok) return null
    try {
      const rows: any[] = JSON.parse(await res.text())
      const hit = rows.find((x) => str(x.patient_code) === uhid)
      return hit ? str(hit.patient_id ?? hit.patient_no_pk) || null : null
    } catch {
      return null
    }
  })
}

/** Search H360's Billing List by invoice no, or one patient's bills in a date range (newest first, max 50). */
export async function searchBills(q: { invoiceNo?: string; uhid?: string; from?: Date; to?: Date }, retry = true): Promise<H360Bill[]> {
  const token = await billToken()
  const pk = q.invoiceNo ? '' : await patientKey(q.uhid ?? '')
  if (!q.invoiceNo && !pk) return []
  const p = new URLSearchParams({ _token: token, draw: '1', start: '0', length: '50', 'search[value]': '', 'search[regex]': 'false', 'order[0][column]': '3', 'order[0][dir]': 'desc' })
  for (let c = 0; c < 37; c++) {
    p.set(`columns[${c}][data]`, String(c))
    p.set(`columns[${c}][name]`, '')
    p.set(`columns[${c}][searchable]`, 'true')
    p.set(`columns[${c}][orderable]`, 'true')
    p.set(`columns[${c}][search][value]`, '')
    p.set(`columns[${c}][search][regex]`, 'false')
  }
  const fields: Record<string, string> = { invoice_id: q.invoiceNo ?? '', hdn_patient_id: pk ?? '', hdn_doctor_id: '', admission_id: '', bill_type: '', corporate_name: '', full_paid: '', due_bill: '', date_from: q.from ? dmy(q.from) : '', date_to: q.to ? dmy(q.to) : '' }
  for (const [k, v] of Object.entries(fields)) p.set(k, v)
  const res = await h360('/search-bill-list', { method: 'POST', headers: { cookie: BILL_MENU, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-csrf-token': token, 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' }, body: p.toString() })
  if (res.status === 419 && retry) {
    forget('h360:bill-csrf')
    return searchBills(q, false)
  }
  if (!res.ok) throw new H360Error('DOWN', `H360 Billing List answered ${res.status}`)
  try {
    const json = JSON.parse(await res.text())
    return ((json.data ?? []) as any[]).map((r) => toBill(Array.isArray(r) ? r : Object.values(r))).filter((x): x is H360Bill => !!x)
  } catch {
    throw new H360Error('PARSE', 'H360 Billing List did not return a bill list')
  }
}

/** The printed bill copy ("Invoice Cum Receipt") as a PDF, for the latest payment (TRX) on the bill. */
export async function billPdf(b: Pick<H360Bill, 'invoiceNo' | 'trx' | 'type'>): Promise<Buffer> {
  const trx = b.trx[b.trx.length - 1]
  if (!trx) throw new H360Error('PARSE', `Bill ${b.invoiceNo} has no transaction to print`)
  const path = b.type === 'PKG' ? `/due-invoice-print-v2-pkg/${b.invoiceNo}/${trx}` : `/bill-invoice-app-print-v2/${b.invoiceNo}/1/${trx}`
  const res = await h360(path, { headers: { cookie: BILL_MENU, accept: 'application/pdf,*/*' } })
  if (!res.ok) throw new H360Error('DOWN', `H360 bill print answered ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const at = buf.indexOf('%PDF')
  if (at < 0 || at > 1024) throw new H360Error('PARSE', 'H360 did not return a PDF for this bill')
  return at ? buf.subarray(at) : buf // H360 prints a stray newline before the PDF header
}

/** Settings → Integrations → Store login → Test: sign in as the store login and read the Family Medicine sub-store. */
export async function testH360Store() {
  const profile = await effective('store')
  const cfg = await getH360Config('store')
  try {
    jars.delete(profile)
    await IntegrationSecret.deleteOne({ _id: KEY[profile].session })
    await session(true, profile)
    const { fetchSubStoreStock } = await import('./h360-store')
    const r = await fetchSubStoreStock({ fresh: true })
    await setStatus({ ok: true, username: cfg?.username, baseUrl: cfg?.baseUrl, error: null, found: r.items.length }, 'store')
    return { ok: true, found: r.items.length, store: r.storeName, totalQty: r.totalQty, usingMain: profile === 'main' }
  } catch (e: any) {
    await setStatus({ ok: false, username: cfg?.username, baseUrl: cfg?.baseUrl, error: e?.message ?? String(e) }, 'store')
    return { ok: false, error: e?.message ?? String(e) }
  }
}
