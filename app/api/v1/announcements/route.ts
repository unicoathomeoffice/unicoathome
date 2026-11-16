import { z } from 'zod'
import { route, body, clientMeta, forbidden } from '@/lib/api'
import { can, rolesOf } from '@/lib/constants'
import { Announcement, User, isOid } from '@/lib/models'
import { notifyUsers } from '@/lib/messaging'
import { audit } from '@/lib/audit'
import { plain } from '@/lib/db'

export const AnnouncementInput = z.object({
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().max(2000).optional(),
  style: z.enum(['INFO', 'SUCCESS', 'WARNING', 'URGENT']).default('INFO'),
  view: z.enum(['BANNER', 'CARD', 'TICKER']).default('CARD'),
  emoji: z.string().max(8).optional(),
  link: z.string().max(300).optional(),
  roles: z.array(z.string()).max(12).default([]),
  userIds: z.array(z.string()).max(200).default([]),
  pinned: z.boolean().default(false),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  /** also a notification on the phone (and in the Notifications list) */
  push: z.boolean().default(true),
})

const live = (now = new Date()) => ({ active: true, deletedAt: null, $and: [{ $or: [{ startAt: null }, { startAt: { $lte: now } }] }, { $or: [{ endAt: null }, { endAt: { $gt: now } }] }] })

/**
 * GET /api/v1/announcements — the announcements this person should see now (pinned first, newest next), with
 * whether they saw it. ?all=1 (announcements.manage): every announcement, for managing them.
 */
export const GET = route(async ({ req, user }) => {
  if (req.nextUrl.searchParams.get('all') === '1') {
    if (!can(user, 'announcements.manage')) throw forbidden()
    const rows = await Announcement.find({ deletedAt: null }).sort({ createdAt: -1 }).limit(100).lean<any[]>()
    return { items: plain(rows.map((a) => ({ ...a, seen: a.seenBy?.length ?? 0, seenBy: undefined }))) }
  }
  const mine = rolesOf(user)
  const rows = await Announcement.find({ ...live(), $or: [{ roles: { $size: 0 }, userIds: { $size: 0 } }, { roles: { $in: mine } }, { userIds: user.id }] })
    .sort({ pinned: -1, createdAt: -1 })
    .limit(20)
    .lean<any[]>()
  return { items: plain(rows.map((a) => ({ ...a, seenByMe: (a.seenBy ?? []).some((x: any) => String(x) === user.id), seenBy: undefined, userIds: undefined }))) }
})

/** POST /api/v1/announcements — make one; with push, everyone it is for gets a notification at once. */
export const POST = route(async ({ req, user }) => {
  if (!can(user, 'announcements.manage')) throw forbidden()
  const i = await body(req, AnnouncementInput)
  const a = await Announcement.create({
    ...i,
    userIds: i.userIds.filter(isOid),
    startAt: i.startAt ? new Date(i.startAt) : undefined,
    endAt: i.endAt ? new Date(i.endAt) : undefined,
    createdBy: user.id,
    createdByName: user.name,
  })
  let notified = 0
  if (i.push) {
    const who = await User.find({
      status: 'ACTIVE',
      deletedAt: null,
      ...(i.roles.length || i.userIds.length ? { $or: [{ role: { $in: i.roles } }, { roles: { $in: i.roles } }, { _id: { $in: i.userIds.filter(isOid) } }] } : {}),
    })
      .select('_id')
      .lean<any[]>()
    await notifyUsers(who.map((u) => u._id), { type: 'ANNOUNCEMENT', title: `${i.emoji ? i.emoji + ' ' : ''}${i.title}`, body: i.body?.slice(0, 300), url: '/announcements', priority: i.style === 'URGENT' ? 'high' : 'normal' })
    notified = who.length
  }
  await audit(user, 'announcement.create', 'announcement', a._id, { after: { title: i.title, roles: i.roles, push: i.push, notified }, label: i.title }, clientMeta(req, user))
  return { ok: true, id: String(a._id), notified }
})
