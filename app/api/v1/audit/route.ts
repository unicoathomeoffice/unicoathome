import { route, qp } from '@/lib/api'
import { AuditLog } from '@/lib/models'
import { plain } from '@/lib/db'
import { dayRange } from '@/lib/format'

/** GET /api/v1/audit?entity=request&entityId=&actor=&action=&from=YYYY-MM-DD&to=&format=csv — append-only, read only */
export const GET = route(
  async ({ req }) => {
    const p = qp(req)
    const f: Record<string, any> = {}
    if (p.get('entity')) f.entity = p.get('entity')
    if (p.get('entityId')) f.entityId = p.get('entityId')
    if (p.get('actor')) f.actorId = p.get('actor')
    if (p.get('action')) f.action = new RegExp(`^${p.get('action')!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    if (p.get('from') || p.get('to')) {
      f.serverAt = {}
      if (p.get('from')) f.serverAt.$gte = dayRange(p.get('from')!).start
      if (p.get('to')) f.serverAt.$lt = dayRange(p.get('to')!).end
    }
    const items = await AuditLog.find(f).sort({ serverAt: -1 }).limit(Math.min(Number(p.get('limit') ?? 200), 5000)).lean<any[]>()
    if (p.get('format') === 'csv') {
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const lines = ['serverAt,actor,role,action,entity,entityId,label,client,ip,before,after']
      for (const a of items) lines.push([a.serverAt?.toISOString(), a.actorName, a.actorRole, a.action, a.entity, a.entityId, a.entityLabel, a.client, a.ip, JSON.stringify(a.before ?? ''), JSON.stringify(a.after ?? '')].map(esc).join(','))
      return new Response(lines.join('\n'), { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="audit-log.csv"' } })
    }
    return { items: plain(items) }
  },
  { perm: 'audit.view' },
)
