import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Download, ExternalLink, Inbox, RotateCcw } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { HomecareRequest, MessageLog, User, isOid } from '@/lib/models'
import { emailConfigured } from '@/lib/messaging'
import { AdminPage } from '@/components/admin/AdminPage'
import { Card, Empty, KV, Kpi, LinkButton, Table, Tabs, Tr, btnClass } from '@/components/ui'
import { ActionButton } from '@/components/client'
import { UrlSearch, UrlSelect } from '@/components/comms/UrlFilters'
import { CHANNEL_LABEL, ChannelIcon, EmailFrame, MSG_STATUS, MsgStatus, PushCard, WaBubble, when } from '@/components/comms/MessageBits'
import { cx, dayRange, isoDay, phone as fmtPhone, time } from '@/lib/format'

export const metadata: Metadata = { title: 'Messages' }

type SP = Promise<Record<string, string | undefined>>
const ROLES = ['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK', 'VIEWER']
const CHANNELS = ['EMAIL', 'WHATSAPP', 'PUSH'] as const
const RANGES: Record<string, number> = { today: 0, '7d': 6, '30d': 29 }

function rangeFrom(range?: string) {
  if (!range || !(range in RANGES)) return null
  return isoDay(Date.now() - RANGES[range] * 86400_000)
}

export default async function MessagesPage({ searchParams }: { searchParams: SP }) {
  const user = await requireWebUser()
  if (!ROLES.includes(user.role)) redirect('/dashboard?denied=1')
  const sp = await searchParams
  const channel = CHANNELS.includes(sp.channel as any) ? sp.channel! : ''
  const limit = Math.min(Number(sp.limit) || 100, 500)

  // filters shared by the list and the tab counts (counts ignore the channel)
  const base: Record<string, any> = {}
  if (sp.status) base.status = { $in: sp.status.split(',') }
  if (sp.template) base.templateKey = sp.template
  const from = rangeFrom(sp.range)
  if (from) base.at = { $gte: dayRange(from).start }
  if (sp.q) {
    const rx = new RegExp(sp.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const reqs = await HomecareRequest.find({ requestNo: rx }).select('_id').limit(50).lean<any[]>()
    base.$or = [{ to: rx }, { toName: rx }, { subject: rx }, { templateKey: rx }, ...(reqs.length ? [{ requestId: { $in: reqs.map((r) => r._id) } }] : [])]
  }
  const f = channel ? { ...base, channel } : base
  const todayStart = dayRange(isoDay()).start

  const [items, total, counts, failedCount, templates, selected, emailToday] = await Promise.all([
    MessageLog.find(f).select('-renderedHtml').sort({ at: -1 }).limit(limit).lean<any[]>(),
    MessageLog.countDocuments(f),
    MessageLog.aggregate([{ $match: base }, { $group: { _id: '$channel', n: { $sum: 1 } } }]),
    MessageLog.countDocuments({ ...(channel ? { channel } : {}), status: 'FAILED' }),
    MessageLog.distinct('templateKey'),
    sp.id && isOid(sp.id) ? MessageLog.findById(sp.id).lean<any>() : null,
    channel === 'EMAIL' ? MessageLog.aggregate([{ $match: { channel: 'EMAIL', at: { $gte: todayStart } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]) : [],
  ])

  // names for initiators / push recipients, request numbers
  const all = selected ? [...items, selected] : items
  const userIds = new Set<string>()
  for (const m of all) {
    if (m.initiatedBy) userIds.add(String(m.initiatedBy))
    if (m.channel === 'PUSH' && isOid(m.to)) userIds.add(m.to)
  }
  const [users, reqs] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } }).select('name role').lean<any[]>(),
    HomecareRequest.find({ _id: { $in: all.map((m) => m.requestId).filter(Boolean) } }).select('requestNo').lean<any[]>(),
  ])
  const userName = (id: unknown) => users.find((u) => String(u._id) === String(id))?.name
  const reqNo = (id: unknown) => reqs.find((r) => String(r._id) === String(id))?.requestNo
  const countOf = (c: string) => counts.find((x: any) => x._id === c)?.n ?? 0
  const countAll = counts.reduce((a: number, x: any) => a + x.n, 0)

  const qs = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v)
    const s = q.toString()
    return s ? `/messages?${s}` : '/messages'
  }
  const exportUrl = `/api/v1/reports?${new URLSearchParams({ type: 'messages', format: 'csv', ...(channel ? { channel } : {}), ...(sp.status ? { status: sp.status } : {}), ...(sp.q ? { q: sp.q } : {}), ...(from ? { from } : {}) }).toString()}`
  const recipient = (m: any) => {
    if (m.channel === 'PUSH') return { name: userName(m.to) ?? 'Staff user', sub: 'in-app' }
    if (m.channel === 'WHATSAPP') return { name: m.toName ?? fmtPhone(m.to), sub: m.toName ? fmtPhone(m.to) : '' }
    const many = String(m.to ?? '').split(',').filter(Boolean)
    return { name: m.toName ?? many[0] ?? '—', sub: m.toName ? many[0] : many.length > 1 ? `+${many.length - 1} more` : '' }
  }
  const es = Object.fromEntries(emailToday.map((x: any) => [x._id, x.n])) as Record<string, number>
  const canResend = ['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK'].includes(user.role)
  const COLS = '96px minmax(150px,1.5fr) minmax(130px,1.2fr) 128px 104px 116px'

  return (
    <AdminPage title={channel === 'EMAIL' ? 'Email log' : 'Messages log'}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <Tabs
            active={channel || 'all'}
            items={[
              { key: 'all', label: `All · ${countAll}`, href: qs({ channel: undefined, id: undefined, limit: undefined }) },
              { key: 'EMAIL', label: `Email · ${countOf('EMAIL')}`, href: qs({ channel: 'EMAIL', id: undefined, limit: undefined }) },
              { key: 'WHATSAPP', label: `WhatsApp · ${countOf('WHATSAPP')}`, href: qs({ channel: 'WHATSAPP', id: undefined, limit: undefined }) },
              { key: 'PUSH', label: `Push · ${countOf('PUSH')}`, href: qs({ channel: 'PUSH', id: undefined, limit: undefined }) },
            ]}
          />
          <div className="flex-1" />
          <UrlSearch value={sp.q} placeholder="Recipient, request no" className="w-[170px]" />
          <UrlSelect param="status" label="Status" value={sp.status ?? ''} options={[{ value: '', label: 'all' }, ...Object.entries(MSG_STATUS).map(([k, v]) => ({ value: k, label: v.label.toLowerCase() })), { value: 'FAILED,SKIPPED', label: 'failed + skipped' }]} />
          <UrlSelect param="template" label="Template" value={sp.template ?? ''} options={[{ value: '', label: 'all' }, ...templates.filter(Boolean).sort().map((t: string) => ({ value: t, label: t }))]} />
          <UrlSelect param="range" value={sp.range ?? ''} options={[{ value: '', label: 'All time' }, { value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }]} />
          <Link href={qs({ status: sp.status === 'FAILED' ? undefined : 'FAILED', id: undefined })} scroll={false} className={cx('inline-flex h-[38px] items-center rounded-lg border px-3 text-[13px] font-semibold', sp.status === 'FAILED' ? 'border-[#DC2626] bg-[#DC2626] text-white' : 'border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]')}>
            Failed · {failedCount}
          </Link>
          <a href={exportUrl} className={btnClass('o', 'md')}>
            <Download size={16} /> Export
          </a>
        </div>

        {channel === 'EMAIL' && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <Kpi dense label="Sent today" n={Object.values(es).reduce((a, b) => a + b, 0)} />
            <Kpi dense label="Delivered" n={(es.SENT ?? 0) + (es.DELIVERED ?? 0) + (es.OPENED ?? 0)} color="#15803D" />
            <Kpi dense label="Queued" n={es.QUEUED ?? 0} color="#B45309" />
            <Kpi dense label="Skipped" n={es.SKIPPED ?? 0} color="#C2410C" sub={emailConfigured() ? undefined : 'Gmail not configured'} />
            <Kpi dense label="Failed" n={es.FAILED ?? 0} color="#B91C1C" />
            <Kpi dense label="Gmail" n={emailConfigured() ? 'Ready' : 'Off'} color={emailConfigured() ? '#15803D' : '#C2410C'} sub={emailConfigured() ? 'SMTP · app password' : 'set GMAIL_USER + APP_PASSWORD'} href="/settings" />
          </div>
        )}

        {!emailConfigured() && channel !== 'PUSH' && (
          <div className="flex items-start gap-2.5 rounded-card border border-[#FED7AA] bg-[#FFF7ED] px-4 py-3 text-[13px] text-[#9A3412]">
            <AlertTriangle size={16} className="mt-px flex-none" />
            <div>
              <b>Gmail is not configured on this server</b>, so emails are logged with status <b>SKIPPED</b> and not delivered. Add <code>GMAIL_USER</code> and <code>GMAIL_APP_PASSWORD</code> (see <Link href="/settings" className="underline">Settings → Gmail</Link>), then use Resend.
            </div>
          </div>
        )}

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <Table cols={COLS} head={['Channel', 'Recipient', 'Template', 'Status', 'Time', 'Request']} empty={<Empty icon={<Inbox size={24} />} title="No messages match" sub="Try another tab or clear the filters." />}>
              {items.map((m) => {
                const rc = recipient(m)
                return (
                  <Tr key={String(m._id)} cols={COLS} href={qs({ id: String(m._id) })} selected={sp.id === String(m._id)}>
                    <span className="flex items-center gap-1.5 text-slate-700">
                      <ChannelIcon channel={m.channel} size={15} />
                      {CHANNEL_LABEL[m.channel] ?? m.channel}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{rc.name}</div>
                      {rc.sub && <div className="truncate text-[12px] text-slate-500">{rc.sub}</div>}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[12px] text-slate-700">{m.templateKey ?? (m.channel === 'PUSH' ? 'notification' : 'free text')}</div>
                      {m.subject && m.channel !== 'WHATSAPP' && <div className="truncate text-[12px] text-slate-500">{m.subject}</div>}
                    </div>
                    <MsgStatus status={m.status} />
                    <div className="min-w-0">
                      <div className="whitespace-nowrap text-[13px]">{when(m.at)}</div>
                      <div className="truncate text-[11.5px] text-slate-500">by {m.initiatedBy ? userName(m.initiatedBy) ?? '—' : 'System'}</div>
                    </div>
                    <span className="truncate font-mono text-[12px] text-slate-700">{reqNo(m.requestId) ?? '—'}</span>
                  </Tr>
                )
              })}
            </Table>
            {total > items.length && (
              <div className="mt-3 flex items-center justify-center gap-3 text-[13px] text-slate-500">
                Showing latest {items.length} of {total}
                <LinkButton href={qs({ limit: String(Math.min(limit + 100, 500)) })} kind="o" size="sm">
                  Load more
                </LinkButton>
              </div>
            )}
          </div>

          <Card className="xl:sticky xl:top-0">
            {selected ? (
              <Preview m={selected} by={selected.initiatedBy ? userName(selected.initiatedBy) : undefined} rc={recipient(selected)} requestNo={reqNo(selected.requestId)} canResend={canResend} />
            ) : (
              <Empty icon={<Inbox size={24} />} title="Select a message" sub="The rendered message, delivery timeline and errors show here." />
            )}
          </Card>
        </div>
      </div>
    </AdminPage>
  )
}

function Preview({ m, by, rc, requestNo, canResend }: { m: any; by?: string; rc: { name: string; sub: string }; requestNo?: string; canResend: boolean }) {
  const resendable = m.channel === 'EMAIL' && ['FAILED', 'SKIPPED'].includes(m.status)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[15px] font-bold">{m.channel === 'EMAIL' && m.subject ? m.subject : 'Preview'}</div>
          <MsgStatus status={m.status} />
        </div>
        <div className="mt-1 text-[12px] text-slate-500">
          {[CHANNEL_LABEL[m.channel], m.provider, m.templateKey, `${when(m.at)}${by ? ` by ${by}` : ''}`].filter(Boolean).join(' · ')}
        </div>
      </div>

      {m.channel === 'EMAIL' ? (
        m.renderedHtml ? (
          <EmailFrame html={m.renderedHtml} height={420} />
        ) : (
          <div className="whitespace-pre-wrap rounded-xl border border-slate-200 p-3.5 text-[13px] text-slate-700">{m.renderedText ?? '—'}</div>
        )
      ) : m.channel === 'WHATSAPP' ? (
        <WaBubble text={m.renderedText ?? ''} at={time(m.at)} ticks={m.status === 'SENT_CONFIRMED'} />
      ) : (
        <PushCard title={m.subject ?? 'Notification'} body={m.renderedText} />
      )}

      {m.error && (
        <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12.5px] text-[#B91C1C]">
          <b>{m.status === 'SKIPPED' ? 'Skipped' : 'Error'}:</b> {m.error}
        </div>
      )}

      <div>
        <KV k="To" v={<span className="break-all">{rc.name}{rc.sub ? ` · ${rc.sub}` : ''}</span>} />
        <KV k="Attempts" v={m.attempts ?? 0} />
        {m.providerId && <KV k="Provider id" v={<span className="break-all font-mono text-[12px]">{m.providerId}</span>} />}
        <KV k="Log id" v={<span className="font-mono text-[12px]">{String(m._id)}</span>} />
      </div>

      <div>
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">Delivery timeline</div>
        <ol className="relative ml-1.5 border-l-2 border-slate-200">
          {(m.events ?? []).map((e: any, i: number) => {
            const st = MSG_STATUS[e.status]
            return (
              <li key={i} className="relative pb-3 pl-4 last:pb-0">
                <span className="absolute -left-[7px] top-1 size-3 rounded-full ring-2 ring-white" style={{ background: st?.fg ?? '#64748B' }} />
                <div className="flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="font-semibold">{st?.label ?? e.status}</span>
                  <span className="whitespace-nowrap text-[12px] text-slate-500">{when(e.at)}</span>
                </div>
                {e.note && <div className="text-[12px] text-slate-500">{e.note}</div>}
              </li>
            )
          })}
          {!m.events?.length && <li className="pl-4 text-[13px] text-slate-400">No events recorded</li>}
        </ol>
      </div>

      <div className="flex flex-wrap gap-2">
        {resendable && canResend && (
          <ActionButton path={`/messages/${m._id}`} method="PATCH" body={{ resend: true }} kind="o" success="Resend attempted — see the timeline">
            <RotateCcw size={16} /> Resend
          </ActionButton>
        )}
        {m.requestId && (
          <LinkButton href={`/requests/${m.requestId}`} kind="o">
            <ExternalLink size={16} /> Open request{requestNo ? ` ${requestNo}` : ''}
          </LinkButton>
        )}
      </div>
    </div>
  )
}
