import type { Metadata } from 'next'
import { Download, Lock, ScrollText, CalendarDays } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { AuditLog, isOid } from '@/lib/models'
import { AdminPage } from '@/components/admin/AdminPage'
import { Card, Empty, LinkButton, Table, Tr, btnClass } from '@/components/ui'
import { UrlDateRange, UrlSelect } from '@/components/comms/UrlFilters'
import { AuditDiff } from '@/components/comms/AuditDiff'
import { cx, dayNum, dayRange, isoDay } from '@/lib/format'

export const metadata: Metadata = { title: 'Audit log' }

type SP = Promise<Record<string, string | undefined>>
const fSec = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const escRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  await requireWebUser('audit.view')
  const sp = await searchParams
  const limit = Math.min(Number(sp.limit) || 200, 1000)
  const f: Record<string, any> = {}
  if (sp.entity) f.entity = sp.entity
  if (sp.actor) f.actorId = isOid(sp.actor) ? sp.actor : null
  if (sp.action) f.action = new RegExp(`^${escRx(sp.action)}`)
  if (sp.client) f.client = sp.client
  if (sp.from || sp.to) {
    f.serverAt = {}
    if (sp.from) f.serverAt.$gte = dayRange(sp.from).start
    if (sp.to) f.serverAt.$lt = dayRange(sp.to).end
  }

  const [rows, total, entities, actors, actions, selected] = await Promise.all([
    AuditLog.find(f).select('-userAgent').sort({ serverAt: -1 }).limit(limit).lean<any[]>(),
    AuditLog.countDocuments(f),
    AuditLog.distinct('entity'),
    AuditLog.aggregate([{ $match: { actorId: { $ne: null } } }, { $group: { _id: '$actorId', name: { $last: '$actorName' }, role: { $last: '$actorRole' } } }, { $sort: { name: 1 } }]),
    AuditLog.distinct('action'),
    sp.id && isOid(sp.id) ? AuditLog.findById(sp.id).lean<any>() : null,
  ])
  const prefixes = [...new Set((actions as string[]).map((a) => a.split('.')[0]))].sort()
  const qs = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v)
    const s = q.toString()
    return s ? `/audit?${s}` : '/audit'
  }
  const csv = `/api/v1/audit?${new URLSearchParams({ format: 'csv', limit: '5000', ...(sp.entity ? { entity: sp.entity } : {}), ...(sp.actor ? { actor: sp.actor } : {}), ...(sp.action ? { action: sp.action } : {}), ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) }).toString()}`
  const today = isoDay()
  const COLS = '80px minmax(100px,1fr) 104px minmax(140px,1.5fr) minmax(100px,1fr) 42px 82px'

  return (
    <AdminPage title="Audit log">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <UrlSelect param="entity" label="Entity" value={sp.entity ?? ''} options={[{ value: '', label: 'all' }, ...(entities as string[]).filter(Boolean).sort().map((e) => ({ value: e, label: e }))]} />
          <UrlSelect param="actor" label="User" value={sp.actor ?? ''} options={[{ value: '', label: 'all' }, ...actors.map((a: any) => ({ value: String(a._id), label: `${a.name} · ${a.role}` }))]} />
          <UrlSelect
            param="action"
            label="Action"
            value={sp.action ?? ''}
            options={[
              { value: '', label: 'all' },
              ...prefixes.map((p) => ({ value: `${p}.`, label: `${p}.*` })),
              ...(actions as string[]).sort().map((a) => ({ value: a, label: a })),
            ]}
          />
          <UrlSelect param="client" label="Client" value={sp.client ?? ''} options={[{ value: '', label: 'all' }, { value: 'web', label: 'web' }, { value: 'app', label: 'app' }]} />
          <UrlDateRange from={sp.from} to={sp.to} icon={<CalendarDays size={15} className="text-slate-500" />} />
          <div className="flex-1" />
          <a href={csv} className={btnClass('o', 'md')}>
            <Download size={16} /> Export CSV
          </a>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <Table cols={COLS} head={['Time', 'Actor', 'Role', 'Action', 'Entity', 'Client', 'IP']} empty={<Empty icon={<ScrollText size={24} />} title="No audit rows match" sub="Clear a filter or widen the dates." />}>
              {rows.map((a) => {
                const d = isoDay(a.serverAt)
                return (
                  <Tr key={String(a._id)} cols={COLS} href={qs({ id: String(a._id) })} selected={sp.id === String(a._id)} className="!min-h-12">
                    <div className="font-mono text-[12.5px] leading-tight">
                      {fSec.format(new Date(a.serverAt))}
                      {d !== today && <div className="font-sans text-[11px] text-slate-400">{dayNum(a.serverAt)}</div>}
                    </div>
                    <span className="block truncate" title={a.actorName}>{a.actorName ?? 'System'}</span>
                    <span className="inline-block h-5 max-w-full truncate rounded leading-5 bg-slate-100 px-1.5 font-mono text-[10.5px] font-bold text-slate-600">{a.actorRole ?? 'SYSTEM'}</span>
                    <span className="block truncate font-mono text-[12px] text-slate-800" title={a.action}>
                      {a.action}
                    </span>
                    <span className="block truncate text-[13px]" title={a.entityId}>
                      {a.entityLabel ?? (a.entityId ? `${a.entity} · ${String(a.entityId).slice(-6)}` : a.entity ?? '—')}
                    </span>
                    <span className="text-[13px] text-slate-600">{a.client ?? '—'}</span>
                    <span className="block truncate font-mono text-[11px] text-slate-500">{a.ip ? maskIp(a.ip) : '—'}</span>
                  </Tr>
                )
              })}
            </Table>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[13px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Lock size={14} /> Append-only · retained 7 years ·
              </span>
              {total > rows.length ? (
                <>
                  Showing latest {rows.length} of {total}
                  <LinkButton href={qs({ limit: String(Math.min(limit + 200, 1000)) })} kind="o" size="sm">
                    Load more
                  </LinkButton>
                </>
              ) : (
                <span>
                  {total} row{total === 1 ? '' : 's'}
                </span>
              )}
            </div>
          </div>

          <Card className={cx('xl:sticky xl:top-0')}>
            {selected ? (
              <AuditDiff row={JSON.parse(JSON.stringify(selected))} time={fSec.format(new Date(selected.serverAt))} day={dayNum(selected.serverAt)} />
            ) : (
              <Empty icon={<ScrollText size={24} />} title="Select a row" sub="The before / after values of the change show here. Audit rows cannot be edited or deleted." />
            )}
          </Card>
        </div>
      </div>
    </AdminPage>
  )
}

function maskIp(ip: string) {
  const parts = ip.split('.')
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.•••` : ip.length > 12 ? `${ip.slice(0, 10)}…` : ip
}
