import 'server-only'
import { parse, type HTMLElement } from 'node-html-parser'
import { getH360Config, h360, H360Error } from './h360'
import { forget, memo } from './memo'
import { Patient } from './models'
import { audit } from './audit'
import type { SessionUser } from './auth'

// Full patient profile from H360 ("View Patient Information": personal, address, payer, family, contact, emergency
// contact, flags). The patient is found by UHID with H360's autocomplete (gives the internal patient number, type and
// company), then /registration/<no> is read — the same page H360's eye button opens. Read-only on the H360 side.

export type H360Profile = {
  patientNo: string
  uhid: string
  name?: string
  category?: string
  company?: string
  gender?: 'M' | 'F' | 'O'
  ageYears?: number
  ageText?: string
  dob?: Date
  bloodGroup?: string
  nationality?: string
  religion?: string
  maritalStatus?: string
  nid?: string
  passport?: string
  occupation?: string
  presentAddress?: string
  permanentAddress?: string
  payerType?: string
  payer?: string
  remarks?: string
  father?: string
  mother?: string
  spouse?: string
  guardianName?: string
  phone?: string
  altPhone?: string
  email?: string
  emergency?: { name?: string; relation?: string; phone?: string }
  flags?: { vip: boolean; nameMasking: boolean; handleWithCare: boolean; fallRisk: boolean }
}

const clean = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').replace(/^\s*:\s*/, '').trim()
const phoneOf = (s?: string) => (s ?? '').replace(/[^\d+]/g, '') || undefined
const nonEmpty = (s?: string) => {
  const v = clean(s).replace(/^,+|,+$/g, '').trim()
  return v && v !== ',' && !/^,?\s*Bangladesh$/i.test(v) ? v : undefined // "  ,Bangladesh" = empty address
}

/** CSRF token for H360 POSTs, from the light (AJAX) patient-list partial. */
function token() {
  return memo('h360p:csrf', 30 * 60_000, async () => {
    const html = await (await h360('/uhl/patient-list', { headers: { 'x-requested-with': 'XMLHttpRequest' } })).text()
    const t = html.match(/name="_token"\s+value="([^"]+)"/)?.[1] ?? html.match(/csrf-token"\s+content="([^"]+)"/)?.[1]
    if (!t) throw new H360Error('PARSE', 'H360 page has no CSRF token')
    return t
  })
}

/** H360's own record for a UHID (autocomplete row), or null. */
async function findByUhid(uhid: string, retry = true): Promise<any | null> {
  const res = await h360('/patient-info-autocomplete', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-csrf-token': await token(), 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' },
    body: new URLSearchParams({ search_data: uhid }).toString(),
  })
  if ((res.status === 419 || res.status === 401) && retry) {
    forget('h360p:csrf')
    return findByUhid(uhid, false)
  }
  if (!res.ok) throw new H360Error('DOWN', `H360 search answered ${res.status}`)
  const j = JSON.parse(await res.text())
  const rows: any[] = Array.isArray(j) ? j : j.data ?? []
  return rows.find((x) => String(x.patient_code ?? '').trim() === uhid) ?? null
}

/** "section|label" → value, from the View Patient Information page. */
function readView(html: string) {
  const doc = parse(html)
  const out = new Map<string, string>()
  for (const label of doc.querySelectorAll('label')) {
    const key = clean(label.text)
    if (!key) continue
    let el: HTMLElement | null = label.nextElementSibling as HTMLElement | null
    const value = el ? clean(el.text) : ''
    // the card's <h5> title tells same-named rows apart (e.g. Emergency Contact → Name)
    let card: HTMLElement | null = label.parentNode as HTMLElement | null
    while (card && !card.classNames?.includes('card')) card = card.parentNode as HTMLElement | null
    const section = clean(card?.querySelector('h5')?.text) || '-'
    out.set(`${section}|${key}`, value)
    if (!out.has(`*|${key}`)) out.set(`*|${key}`, value)
    el = null
  }
  const flags = (name: string) => new RegExp(`${name}\\s*:\\s*Yes`, 'i').test(doc.text.replace(/\s+/g, ' '))
  return { get: (section: string, label: string) => out.get(`${section}|${label}`) ?? out.get(`*|${label}`) ?? '', flags }
}

const dmy = (s?: string) => {
  const m = clean(s).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  return m ? new Date(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T12:00:00+06:00`) : undefined
}

/** Everything H360 knows about a UHID, or null when H360 isn't set up or the UHID isn't there. */
export async function h360Profile(uhid: string): Promise<H360Profile | null> {
  if (!uhid?.trim() || !(await getH360Config())) return null
  const hit = await findByUhid(uhid.trim())
  if (!hit) return null
  const no = String(hit.patient_no_pk ?? hit.patient_id ?? '').trim()
  if (!no) return null
  const html = await (await h360(`/registration/${encodeURIComponent(no)}`, { headers: { 'x-requested-with': 'XMLHttpRequest' } })).text()
  const v = readView(html)
  const g = (v.get('Personal Information', 'Gender') || String(hit.gender ?? '')).toLowerCase()
  const yy = Number(hit.age_yy)
  return {
    patientNo: no,
    uhid: uhid.trim(),
    name: nonEmpty(v.get('Personal Information', 'Patient Name')) ?? nonEmpty(hit.patient_name),
    category: nonEmpty(hit.patient_type_code),
    company: nonEmpty(hit.ccm_client_name),
    gender: g.startsWith('f') ? 'F' : g.startsWith('m') ? 'M' : g ? 'O' : undefined,
    ageYears: Number.isFinite(yy) && String(hit.age_yy ?? '') !== '' ? yy : undefined,
    ageText: nonEmpty(v.get('Personal Information', 'Patient Age')) ?? nonEmpty(hit.age),
    dob: dmy(v.get('Personal Information', 'Patient DOB')) ?? dmy(hit.dob),
    bloodGroup: nonEmpty(v.get('Personal Information', 'Blood Group')),
    nationality: nonEmpty(v.get('Personal Information', 'Nationality')),
    religion: nonEmpty(v.get('Personal Information', 'Religion')),
    maritalStatus: nonEmpty(v.get('Personal Information', 'Marital Status')),
    nid: nonEmpty(v.get('Personal Information', 'NID')),
    passport: nonEmpty(v.get('Personal Information', 'Passport No')),
    occupation: nonEmpty(v.get('Personal Information', 'Occupation')),
    presentAddress: nonEmpty(v.get('Address Information', 'Present')),
    permanentAddress: nonEmpty(v.get('Address Information', 'Permanent')),
    payerType: nonEmpty(v.get('Payer Information', 'Payer Type')),
    payer: nonEmpty(v.get('Payer Information', 'Payer')),
    remarks: nonEmpty(v.get('Others Information', 'Reg. Remarks')),
    father: nonEmpty(v.get('Family Information', 'Father')),
    mother: nonEmpty(v.get('Family Information', 'Mother')),
    spouse: nonEmpty(v.get('Family Information', 'Spouse')) ?? nonEmpty(hit.spouse_name),
    guardianName: nonEmpty(v.get('Family Information', 'G. Name')),
    phone: phoneOf(v.get('Contact', 'Mobile')) ?? phoneOf(hit.phone_mobile),
    altPhone: phoneOf(v.get('Contact', 'Alt. Phone')) ?? phoneOf(hit.alt_phone_mobile),
    email: [v.get('Contact', 'Email'), String(hit.email ?? '')].map(clean).find((e) => /^\S+@\S+\.\S+$/.test(e)),
    emergency: {
      name: nonEmpty(v.get('Emergency Contact', 'Name')),
      relation: nonEmpty(v.get('Emergency Contact', 'Relation')),
      phone: phoneOf(v.get('Emergency Contact', 'Contact')) ?? phoneOf(hit.emergency_contact_contact),
    },
    flags: { vip: v.flags('VIP'), nameMasking: v.flags('Name Masking'), handleWithCare: v.flags('Handle With Care'), fallRisk: v.flags('Fall Risk') },
  }
}

/**
 * Bring a patient's profile in step with H360 (by UHID). H360 values fill or replace ours; a field H360 leaves empty
 * never wipes what staff typed. The main phone, name and our address (house / flat / map pin) are kept as they are —
 * H360's present address only fills an empty one. Returns the changed field names (empty = nothing new).
 */
export async function syncPatientFromH360(patientId: unknown, actor?: SessionUser | null): Promise<{ changed: string[]; found: boolean }> {
  const p = await Patient.findById(patientId)
  if (!p?.uhid) return { changed: [], found: false }
  const h = await h360Profile(p.uhid)
  const changed: string[] = []
  if (!h) {
    p.set('h360.syncedAt', new Date())
    await p.save()
    return { changed, found: false }
  }
  const put = (path: string, value: unknown) => {
    if (value == null || value === '') return
    const cur = p.get(path)
    const same = value instanceof Date ? cur && new Date(cur).getTime() === value.getTime() : cur === value
    if (same) return
    p.set(path, value)
    changed.push(path)
  }
  put('category', h.category)
  put('company', h.company)
  put('gender', h.gender)
  put('ageYears', h.ageYears)
  put('dob', h.dob)
  put('bloodGroup', h.bloodGroup)
  put('nationality', h.nationality)
  put('religion', h.religion)
  put('maritalStatus', h.maritalStatus)
  put('nid', h.nid)
  put('passport', h.passport)
  put('occupation', h.occupation)
  put('permanentAddress', h.permanentAddress)
  put('payer.type', h.payerType)
  put('payer.name', h.payer)
  put('family.father', h.father)
  put('family.mother', h.mother)
  put('family.spouse', h.spouse)
  put('family.guardianName', h.guardianName)
  if (h.altPhone && h.altPhone !== p.phone) put('altPhone', h.altPhone)
  put('email', h.email)
  put('guardian.name', h.emergency?.name)
  put('guardian.relation', h.emergency?.relation)
  put('guardian.phone', h.emergency?.phone)
  if (!p.address?.full && h.presentAddress) put('address.full', h.presentAddress)
  for (const [k, on] of Object.entries(h.flags ?? {})) if (on || p.get(`flags.${k}`)) put(`flags.${k}`, on)
  p.set('h360', { ...(p.h360?.toObject?.() ?? p.h360 ?? {}), patientNo: h.patientNo, ageText: h.ageText, remarks: h.remarks, syncedAt: new Date() })
  await p.save()
  if (changed.length) await audit(actor ?? null, 'patient.h360_sync', 'patient', p._id, { after: Object.fromEntries(changed.map((k) => [k, p.get(k)])), label: p.name })
  return { changed, found: true }
}

/** Fire-and-forget version for request creation / page views; never throws. */
export async function syncPatientQuietly(patientId: unknown) {
  try {
    await syncPatientFromH360(patientId)
  } catch (e) {
    console.error('[h360 patient sync]', e instanceof Error ? e.message : e)
  }
}
