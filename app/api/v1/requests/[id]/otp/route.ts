import { createHash, randomInt, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { route, body, bad, forbidden, clientMeta } from '@/lib/api'
import { Patient, Setting } from '@/lib/models'
import { loadRequest, isTeamMember, patientConfirmation } from '@/lib/services/requests'
import { prepareWhatsApp, waLink, waNumber } from '@/lib/messaging'
import { getSettings } from '@/lib/settings'
import { audit } from '@/lib/audit'

const TTL_MIN = 5
const MAX_TRIES = 3
const key = (id: unknown) => `otp:${id}`
const hash = (id: unknown, code: string) => createHash('sha256').update(`${id}:${code}:${process.env.JWT_SECRET ?? ''}`).digest('hex')
const mask = (p: string) => {
  const d = waNumber(p)
  return d.length > 8 ? `+${d.slice(0, 3)} ${d.slice(3, 5)}•• •••${d.slice(-3)}` : '•••'
}

/**
 * POST /api/v1/requests/:id/otp — generate a 4-digit visit confirmation code for the patient.
 * The code is stored hashed (Setting `otp:<requestId>`, 5 min, 3 attempts) and sent by the staff
 * member's WhatsApp (deep link). The message log keeps a masked copy.
 */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  if (!isTeamMember(user, r)) throw forbidden('Only the assigned care team can confirm the visit')
  const s = await getSettings()
  if (!s.features.otpConfirmation) throw bad('OTP confirmation is turned off · use signature or verbal')
  const p = await Patient.findById(r.patientId).select('name phone consent').lean<any>()
  const phone = p?.phone ?? r.patientSnapshot?.phone
  if (!phone) throw bad('The patient has no phone number · use signature or verbal')
  await Setting.deleteMany({ key: /^otp:/, 'value.expiresAt': { $lt: new Date() } })
  const code = String(randomInt(0, 10000)).padStart(4, '0')
  const expiresAt = new Date(Date.now() + TTL_MIN * 60_000)
  await Setting.updateOne({ key: key(r._id) }, { value: { hash: hash(r._id, code), expiresAt, attempts: 0, by: user.id }, updatedBy: user.id }, { upsert: true })
  const msg = (c: string) => `Unico HomeCare: your visit confirmation code is ${c}. Share it with ${user.name} only if the visit ${r.requestNo} took place today. Valid for ${TTL_MIN} minutes.`
  const wa = await prepareWhatsApp({ to: phone, toName: p?.name, text: msg('••••'), templateKey: 'visit_otp', requestId: r._id, patientId: r.patientId, initiatedBy: user.id })
  await audit(user, 'visit.otp_sent', 'request', r._id, { after: { to: wa.to, expiresAt }, label: r.requestNo }, clientMeta(req, user))
  return { url: waLink(phone, msg(code)), logId: wa.logId, expiresAt, to: mask(phone), ttlMin: TTL_MIN }
})

const Verify = z.object({ code: z.string().regex(/^\d{4}$/, '4 digits'), relation: z.string().optional(), name: z.string().optional() })

/** PUT /api/v1/requests/:id/otp {code, relation?, name?} — verify and record patient confirmation type OTP. */
export const PUT = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  if (!isTeamMember(user, r)) throw forbidden('Only the assigned care team can confirm the visit')
  const input = await body(req, Verify)
  const row = await Setting.findOne({ key: key(r._id) })
  const v = row?.value as { hash: string; expiresAt: string; attempts: number } | undefined
  if (!row || !v?.hash) throw bad('Send a code to the patient first')
  if (new Date(v.expiresAt).getTime() < Date.now()) {
    await Setting.deleteOne({ _id: row._id })
    throw bad('The code has expired · send a new one', { code: 'Expired' })
  }
  if ((v.attempts ?? 0) >= MAX_TRIES) throw bad('Too many wrong attempts · send a new code', { code: 'Locked' })
  const ok = timingSafeEqual(Buffer.from(hash(r._id, input.code)), Buffer.from(v.hash))
  if (!ok) {
    const attempts = (v.attempts ?? 0) + 1
    await Setting.updateOne({ _id: row._id }, { 'value.attempts': attempts })
    await audit(user, 'visit.otp_failed', 'request', r._id, { after: { attempts }, label: r.requestNo }, clientMeta(req, user))
    throw bad(attempts >= MAX_TRIES ? 'Wrong code · no attempts left, send a new code' : `Wrong code · ${MAX_TRIES - attempts} attempt${MAX_TRIES - attempts === 1 ? '' : 's'} left`, { code: 'Wrong code' })
  }
  await Setting.deleteOne({ _id: row._id })
  await patientConfirmation(r, { type: 'OTP', relation: input.relation, name: input.name }, user, clientMeta(req, user))
  return { ok: true, at: new Date() }
})
