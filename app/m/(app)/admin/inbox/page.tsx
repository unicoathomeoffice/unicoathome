import Link from 'next/link'
import { Plus, Inbox } from 'lucide-react'
import { MScreen } from '@/components/mobile'
import { AutoRefresh } from '@/components/client'
import { SlaPill, PriorityBadge, StatusChip, Empty } from '@/components/ui'
import { SegLinks, ALink, ageG, shortName } from '@/components/coord/ui'
import { PostButton, CancelRequestButton } from '@/components/coord/actions'
import { requireDesk } from '@/components/coord/data'
import { HomecareRequest } from '@/lib/models'
import { can } from '@/lib/constants'
import { getSettings } from '@/lib/settings'
import { slaInfo, withPeople } from '@/lib/services/requests'
import { relDay, time } from '@/lib/format'

export const metadata = { title: 'Request inbox' }

const TABS = {
  new: ['NEW', 'VERIFIED'],
  confirmed: ['CONFIRMED', 'RESCHEDULED'],
  awaiting: ['ASSIGNED'],
} as const
type Tab = keyof typeof TABS

function when(r: any) {
  if (r.scheduledAt) return `${relDay(r.scheduledAt)} ${time(r.scheduledAt)}`
  const p = r.preferred ?? {}
  if (p.date) return `prefers ${relDay(`${p.date}T12:00:00+06:00`)}${p.slot ? ` · ${p.slot}` : p.time ? ` ${p.time}` : ''}`
  return 'no preferred time'
}

/** M17 Request inbox — NEW / CONFIRMED / awaiting accept with SLA pills and quick actions. */
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireDesk()
  const sp = await searchParams
  const tab: Tab = (sp.tab as Tab) in TABS ? (sp.tab as Tab) : 'new'
  const [counts, rows, settings] = await Promise.all([
    HomecareRequest.aggregate([{ $match: { deletedAt: null, status: { $in: Object.values(TABS).flat() } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    HomecareRequest.find({ deletedAt: null, status: { $in: TABS[tab] } })
      .select('requestNo status priority patientSnapshot services preferred scheduledAt slot timeline assignment transport createdBy')
      .lean<any[]>(),
    getSettings(),
  ])
  await withPeople(rows)
  const n = (t: Tab) => counts.filter((c) => (TABS[t] as readonly string[]).includes(c._id)).reduce((a, c) => a + c.n, 0)
  const items = rows
    .map((r) => ({ ...r, sla: slaInfo(r, settings) }))
    .sort((a, b) => {
      const pr = { EMERGENCY: 0, URGENT: 1, ROUTINE: 2 } as Record<string, number>
      if (pr[a.priority] !== pr[b.priority]) return pr[a.priority] - pr[b.priority]
      return +new Date(a.sla?.dueAt ?? a.scheduledAt ?? a.createdAt) - +new Date(b.sla?.dueAt ?? b.scheduledAt ?? b.createdAt)
    })
  const manage = can(user, 'requests.manage')
  const assign = can(user, 'requests.assign')

  return (
    <MScreen
      title="Request inbox"
      back="/m/admin"
      right={
        <Link href="/m/new-request" className="flex size-10 items-center justify-center text-primary" aria-label="New request">
          <Plus size={24} />
        </Link>
      }
      tab="admin"
    >
      <AutoRefresh seconds={20} />
      <SegLinks
        active={tab}
        items={[
          { key: 'new', label: `New · ${n('new')}`, href: '/m/admin/inbox?tab=new' },
          { key: 'confirmed', label: `Confirmed · ${n('confirmed')}`, href: '/m/admin/inbox?tab=confirmed' },
          { key: 'awaiting', label: `Awaiting · ${n('awaiting')}`, href: '/m/admin/inbox?tab=awaiting' },
        ]}
      />
      {!items.length && <Empty icon={<Inbox size={26} />} title={tab === 'new' ? 'No new requests' : tab === 'confirmed' ? 'Nothing waiting for a team' : 'No one to chase'} sub="New requests from the phone line, WhatsApp and field staff land here." />}
      {items.map((r) => {
        const id = String(r._id)
        const staff = [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean)
        return (
          <div key={id} className="rounded-card bg-white px-3.5 py-3 shadow-card">
            <Link href={`/m/admin/requests/${id}`} className="block">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-bold text-slate-500">{r.requestNo}</div>
                <div className="flex gap-1.5">
                  <PriorityBadge priority={r.priority} />
                  {r.sla && <SlaPill tone={r.sla.tone} label={r.sla.label} />}
                </div>
              </div>
              <div className="mt-2 text-[15px] font-semibold">
                {r.patientSnapshot?.name} <span className="font-normal text-slate-500">· {ageG(r.patientSnapshot?.ageYears, r.patientSnapshot?.gender)}</span>
              </div>
              <div className="text-[13px] text-slate-500">
                {(r.services ?? []).map((s: any) => s.name).join(', ')} · {r.patientSnapshot?.area ?? '—'} · {when(r)}
              </div>
              {tab === 'new' && r.createdByUser && (
                <div className="mt-0.5 text-[12px] text-slate-400">
                  by {shortName(r.createdByUser.name)} · {time(r.timeline?.requestedAt)}
                  {r.status === 'VERIFIED' && ' · verified'}
                </div>
              )}
              {tab === 'awaiting' && staff.length > 0 && <div className="mt-0.5 text-[12px] text-slate-500">Waiting for {staff.map((s: any) => shortName(s.name)).join(' + ')}</div>}
              {tab === 'confirmed' && r.transport?.needed && <div className="mt-0.5 text-[12px] font-semibold text-[#0E7490]">Car requested{r.status === 'RESCHEDULED' ? ' · rescheduled' : ''}</div>}
              {r.status === 'RESCHEDULED' && !r.transport?.needed && (
                <div className="mt-1">
                  <StatusChip status="RESCHEDULED" sm />
                </div>
              )}
            </Link>
            <div className="mt-2.5 flex gap-2">
              {manage && <CancelRequestButton id={id} requestNo={r.requestNo} />}
              {tab === 'new' && (
                <>
                  {manage && r.status === 'NEW' && (
                    <PostButton path={`/requests/${id}/verify`} kind="s" className="flex-1" success={`${r.requestNo} verified`}>
                      Verify
                    </PostButton>
                  )}
                  {manage ? (
                    <ALink href={`/m/admin/requests/${id}/confirm`} className="flex-1">
                      Confirm
                    </ALink>
                  ) : (
                    <ALink href={`/m/admin/requests/${id}`} kind="s" className="flex-1">
                      Open
                    </ALink>
                  )}
                </>
              )}
              {tab === 'confirmed' &&
                (assign ? (
                  <ALink href={`/m/admin/requests/${id}/assign`} className="flex-1">
                    Assign team
                  </ALink>
                ) : (
                  <ALink href={`/m/admin/requests/${id}`} kind="s" className="flex-1">
                    Open
                  </ALink>
                ))}
              {tab === 'awaiting' && (
                <>
                  <ALink href={`/m/admin/requests/${id}`} kind="s" className="flex-1">
                    Open
                  </ALink>
                  {assign && (
                    <ALink href={`/m/admin/requests/${id}/assign`} className="flex-1">
                      Reassign
                    </ALink>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
      <div className="text-center text-[12px] text-slate-400">
        Routine target {settings.sla?.confirmRoutineMin ?? 15} min · Urgent {settings.sla?.confirmUrgentMin ?? 5} min · Emergency immediate
      </div>
    </MScreen>
  )
}

