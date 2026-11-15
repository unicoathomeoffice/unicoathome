import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { publicRoute, body, clientMeta, ApiError } from '@/lib/api'
import { User } from '@/lib/models'
import { checkLink, deviceCookie, verifyDevice } from '@/lib/services/staff-links'
import { kitRows, packKit, PackInput } from '@/lib/services/kit'

// The no-login staff link (/v/<token>): GET the visit's bag + checklist · POST { employeeId } to let this phone in ·
// PATCH { itemId, packedQty } to tick what's packed. Never cached; throttled per IP.

const hits = new Map<string, number[]>()
function throttle(req: NextRequest, max = 60) {
  const ip = clientMeta(req).ip || 'x'
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  if (recent.length >= max) throw new ApiError(429, 'RATE_LIMITED', 'Too many tries — wait a minute')
  hits.set(ip, [...recent, now])
}
const noStore = (data: unknown, init?: ResponseInit) => {
  const res = NextResponse.json(data, init)
  res.headers.set('cache-control', 'no-store')
  res.headers.set('x-robots-tag', 'noindex')
  return res
}
const fail = (reason: string, until?: string) =>
  noStore({ ok: false, reason, until: until ?? null, message: reason === 'expired' ? 'This link has expired.' : reason === 'locked' ? 'Too many wrong IDs — try again in 15 minutes.' : 'This link is not valid any more.' }, { status: reason === 'locked' ? 423 : 404 })

const time = (d?: Date | null) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(d)) : null)

async function view(c: Extract<Awaited<ReturnType<typeof checkLink>>, { ok: true }>, token: string) {
  const r = c.r
  const ids = [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].filter(Boolean)
  const [team, kit] = await Promise.all([User.find({ _id: { $in: ids } }).select('name').lean<any[]>(), kitRows(r)])
  return {
    ok: true,
    verified: true,
    me: c.user.name,
    visit: {
      when: time(r.scheduledAt),
      services: (r.services ?? []).map((s: any) => s.name),
      tests: [...new Set([...(r.testItems ?? []).map((t: any) => t.name), ...(r.tests ?? [])].filter(Boolean))],
      // privacy: first name + area only (no phone, no full address)
      patient: String(r.patientSnapshot?.name ?? '').split(' ')[0] || 'Patient',
      area: r.patientSnapshot?.area ?? null,
      status: r.status,
      team: team.map((u) => u.name),
      pickup: r.transport?.needed && r.transport?.timesSetAt ? time(r.transport.pickupAt) : null,
    },
    canPack: ['ASSIGNED', 'ACCEPTED', 'CONFIRMED'].includes(r.status),
    kit: kit.map((k) => ({ ...k, image: k.imageId ? `/api/v1/public/visit-link/${token}/image/${k.itemId}?v=${k.imageId}` : null })),
    checklist: (r.visit?.checklist ?? []).map((x: any) => ({ key: x.key, label: x.label, mandatory: x.mandatory !== false, done: !!x.done })),
  }
}

export const GET = publicRoute<{ token: string }>(async ({ req, params }) => {
  throttle(req)
  const probe = await checkLink(params.token)
  if (!probe.ok) return fail(probe.reason, probe.until)
  const c = await checkLink(params.token, req.cookies.get(deviceCookie(probe.link))?.value)
  if (!c.ok) return fail(c.reason, c.until)
  if (!c.verified) return noStore({ ok: true, verified: false, first: String(c.user.name ?? '').split(' ')[0] })
  return noStore(await view(c, params.token))
})

export const POST = publicRoute<{ token: string }>(async ({ req, params }) => {
  throttle(req, 20)
  const { employeeId } = await body(req, z.object({ employeeId: z.string().trim().min(1).max(40) }))
  const c = await checkLink(params.token)
  if (!c.ok) return fail(c.reason, c.until)
  const v = await verifyDevice(c.link, c.user, employeeId, clientMeta(req))
  if (!v.ok) return noStore({ ok: false, reason: v.locked ? 'locked' : 'wrong', left: v.left, message: v.locked ? 'Too many wrong IDs — try again in 15 minutes.' : `That employee ID doesn't match. ${v.left} tr${v.left === 1 ? 'y' : 'ies'} left.` }, { status: 401 })
  const res = noStore({ ok: true })
  res.cookies.set(deviceCookie(c.link), v.deviceId, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires: new Date(c.link.expiresAt) })
  return res
})

export const PATCH = publicRoute<{ token: string }>(async ({ req, params }) => {
  throttle(req)
  const input = await body(req, PackInput.extend({ itemId: z.string().regex(/^[a-f0-9]{24}$/i) }))
  const probe = await checkLink(params.token)
  if (!probe.ok) return fail(probe.reason, probe.until)
  const c = await checkLink(params.token, req.cookies.get(deviceCookie(probe.link))?.value)
  if (!c.ok) return fail(c.reason, c.until)
  if (!c.verified) throw new ApiError(401, 'VERIFY', 'Enter your employee ID first')
  // packed by the link's staff member (they are on the team — checked above); audited like the app
  const actor = { id: String(c.user._id), name: c.user.name, role: c.user.role, roles: [c.user.role] } as any
  await packKit(c.r, input.itemId, { packedQty: input.packedQty }, actor, { actsForTeam: false }, { ...clientMeta(req), client: 'staff-link' })
  return noStore({ ok: true })
})
