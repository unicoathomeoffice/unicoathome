import 'server-only'
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { HomecareRequest, StaffLink, User } from '../models'
import { audit, type Meta } from '../audit'
import { baseUrl } from '../links'
import { dayRange, isoDay } from '../format'

// No-login staff link: an assigned staff member opens the visit's bag (tick what's packed) and checklist without
// signing in. Security:
//  · 32 random bytes per link, one per staff member per visit; looked up by SHA-256 hash; the token itself is stored
//    AES-256-GCM-encrypted with JWT_SECRET (so the request page can show / resend it; a DB copy alone can't open it)
//  · works only while the person is still on the team, the visit isn't cancelled / closed, and before it expires
//    (end of the visit day + 12 h); revoked on reassign / undo / cancel / close or by hand
//  · first open on a phone asks for their employee ID; that phone is remembered (httpOnly cookie, hash stored);
//    5 wrong IDs lock the link for 15 minutes
//  · the page shows no patient phone or full address

const DONE = ['CANCELLED', 'CLOSED']
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const key = () => createHash('sha256').update(`staff-link:${process.env.JWT_SECRET ?? ''}`).digest()

function encrypt(token: string) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(token, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.')
}
function decrypt(v: string) {
  try {
    const [iv, tag, enc] = v.split('.').map((x) => Buffer.from(x, 'base64url'))
    const d = createDecipheriv('aes-256-gcm', key(), iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

export const linkUrl = (token: string) => `${baseUrl()}/v/${token}`
const expiryFor = (r: any) => new Date(dayRange(isoDay(r.scheduledAt ?? new Date())).end.getTime() + 12 * 3600_000)
const onTeam = (r: any, userId: unknown) => [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].map(String).includes(String(userId))

/** The staff member's current link for this visit (reused while valid), or a new one. `fresh` revokes the old first. */
export async function staffLinkFor(r: any, userId: unknown, by?: string, opts: { fresh?: boolean } = {}) {
  const now = new Date()
  if (!opts.fresh) {
    const cur = await StaffLink.findOne({ requestId: r._id, userId, revokedAt: null, expiresAt: { $gt: now } }).sort({ createdAt: -1 }).lean<any>()
    const token = cur ? decrypt(cur.tokenEnc) : null
    if (token) return linkUrl(token)
  }
  await StaffLink.updateMany({ requestId: r._id, userId, revokedAt: null }, { $set: { revokedAt: now } })
  const token = randomBytes(32).toString('base64url')
  await StaffLink.create({ tokenHash: sha(token), tokenEnc: encrypt(token), requestId: r._id, userId, expiresAt: expiryFor(r), createdBy: by })
  return linkUrl(token)
}

/** Turn off links: the whole visit, or only the people who left the team. */
export async function revokeStaffLinks(requestId: unknown, userIds?: unknown[]) {
  await StaffLink.updateMany({ requestId, revokedAt: null, ...(userIds ? { userId: { $in: userIds } } : {}) }, { $set: { revokedAt: new Date() } })
}

export type LinkCheck =
  | { ok: false; reason: 'invalid' | 'expired' | 'locked'; until?: string }
  | { ok: true; link: any; r: any; user: any; verified: boolean }

/** Find a link by its token and check it is still usable; `deviceId` (from the cookie) decides if this phone is known. */
export async function checkLink(token: string, deviceId?: string | null): Promise<LinkCheck> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return { ok: false, reason: 'invalid' }
  const link = await StaffLink.findOne({ tokenHash: sha(token) }).lean<any>()
  if (!link || link.revokedAt) return { ok: false, reason: 'invalid' }
  if (new Date(link.expiresAt) < new Date()) return { ok: false, reason: 'expired' }
  if (link.lockedUntil && new Date(link.lockedUntil) > new Date()) return { ok: false, reason: 'locked', until: new Date(link.lockedUntil).toISOString() }
  const [r, user] = await Promise.all([HomecareRequest.findById(link.requestId), User.findById(link.userId).select('name employeeId role status deletedAt').lean<any>()])
  if (!r || r.deletedAt || DONE.includes(r.status) || !user || user.status !== 'ACTIVE' || user.deletedAt || !onTeam(r, link.userId)) return { ok: false, reason: 'invalid' }
  const dh = deviceId ? sha(deviceId) : null
  const verified = !!dh && (link.deviceHashes ?? []).some((h: string) => h.length === dh.length && timingSafeEqual(Buffer.from(h), Buffer.from(dh)))
  if (verified) await StaffLink.updateOne({ _id: link._id }, { $inc: { uses: 1 }, $set: { lastUsedAt: new Date() } })
  return { ok: true, link, r, user, verified }
}

/** First open on a phone: the employee ID proves it is them. Returns a new device id for the cookie, or why not. */
export async function verifyDevice(link: any, user: any, employeeId: string, meta: Meta): Promise<{ ok: true; deviceId: string } | { ok: false; left: number; locked?: string }> {
  const given = employeeId.trim().toLowerCase()
  const want = String(user.employeeId ?? '').trim().toLowerCase()
  const match = !!want && given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want))
  if (!match) {
    const fails = (link.failCount ?? 0) + 1
    const locked = fails >= 5 ? new Date(Date.now() + 15 * 60_000) : null
    await StaffLink.updateOne({ _id: link._id }, { $set: { failCount: locked ? 0 : fails, ...(locked ? { lockedUntil: locked } : {}) } })
    await audit(null, 'staff_link.wrong_id', 'request', link.requestId, { after: { userId: String(link.userId), tries: fails, locked: !!locked } }, meta)
    return { ok: false, left: locked ? 0 : 5 - fails, locked: locked?.toISOString() }
  }
  const deviceId = randomBytes(24).toString('base64url')
  await StaffLink.updateOne({ _id: link._id }, { $push: { deviceHashes: { $each: [sha(deviceId)], $slice: -5 } }, $set: { failCount: 0, lockedUntil: null, lastUsedAt: new Date() }, $inc: { uses: 1 } })
  await audit({ id: String(user._id), name: user.name, role: user.role }, 'staff_link.open', 'request', link.requestId, { after: { via: 'staff-link' } }, meta)
  return { ok: true, deviceId }
}

/** After a (re)assignment: links of people no longer on the team stop working. */
export async function revokeLeavers(requestId: unknown, teamIds: unknown[]) {
  await StaffLink.updateMany({ requestId, revokedAt: null, userId: { $nin: teamIds.filter(Boolean) } }, { $set: { revokedAt: new Date() } })
}

/** Cookie name for a link's remembered phone. */
export const deviceCookie = (link: any) => `hc_sl_${String(link._id)}`
