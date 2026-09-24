import { route, qp } from '@/lib/api'
import { MessageLog, User } from '@/lib/models'
import { plain } from '@/lib/db'

/** GET /api/v1/messages?channel=EMAIL&status=FAILED&requestId=&limit= (W12 · E3) */
export const GET = route(
  async ({ req }) => {
    const p = qp(req)
    const f: Record<string, any> = {}
    if (p.get('channel')) f.channel = { $in: p.get('channel')!.split(',') }
    if (p.get('status')) f.status = { $in: p.get('status')!.split(',') }
    if (p.get('requestId')) f.requestId = p.get('requestId')
    if (p.get('q')) f.$or = [{ to: new RegExp(p.get('q')!, 'i') }, { toName: new RegExp(p.get('q')!, 'i') }, { subject: new RegExp(p.get('q')!, 'i') }]
    const items = await MessageLog.find(f).select('-renderedHtml').sort({ at: -1 }).limit(Math.min(Number(p.get('limit') ?? 100), 500)).lean<any[]>()
    const users = await User.find({ _id: { $in: items.map((i) => i.initiatedBy).filter(Boolean) } }).select('name').lean<any[]>()
    for (const i of items) i.initiatedByName = users.find((u) => String(u._id) === String(i.initiatedBy))?.name ?? 'System'
    const counts = await MessageLog.aggregate([{ $group: { _id: '$channel', n: { $sum: 1 } } }])
    return { items: plain(items), counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) }
  },
  { roles: ['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK', 'VIEWER'] },
)
