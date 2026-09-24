import { redirect } from 'next/navigation'
import { Calendar, Clock } from 'lucide-react'
import { MScreen, MCard } from '@/components/mobile'
import { PriorityBadge } from '@/components/ui'
import { AssignForm } from '@/components/coord/AssignForm'
import { requireDesk, loadCoordRequest } from '@/components/coord/data'
import { ServiceType } from '@/lib/models'
import { rankCandidates } from '@/lib/services/requests'
import { relDay, time, dayNum, dur } from '@/lib/format'
import { plain } from '@/lib/db'

export const metadata = { title: 'Assign team' }

/** M18 + S3 (5d) — Stage 3: coordinator assigns the care team. */
export default async function AssignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireDesk('requests.assign')
  const { id } = await params
  const { r } = await loadCoordRequest(id, user)
  if (!['CONFIRMED', 'RESCHEDULED', 'ASSIGNED', 'ACCEPTED'].includes(r.status)) redirect(`/m/admin/requests/${id}`)
  const [candidates, types] = await Promise.all([
    rankCandidates(r, 60, ['DOCTOR', 'NURSE', 'ALLIED']),
    ServiceType.find({ _id: { $in: (r.services ?? []).map((s: any) => s.serviceTypeId).filter(Boolean) } }).select('staffMix name defaultDurationMin').lean<any[]>(),
  ])
  const need: Record<string, number> = {}
  for (const t of types) for (const m of t.staffMix ?? []) need[m.role] = Math.max(need[m.role] ?? 0, m.count ?? 1)
  const needTotal = Object.values(need).reduce((a, b) => a + b, 0) || 1
  const team = [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].filter(Boolean).map(String)
  const services = (r.services ?? []).map((s: any) => s.name).join(' + ')
  return (
    <MScreen title={team.length ? 'Reassign team' : 'Assign team'} sub={`${r.requestNo} · ${r.scheduledAt ? `${dayNum(r.scheduledAt)} ${time(r.scheduledAt)}` : 'time not set'}`} back={`/m/admin/requests/${id}`}>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <MCard>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[15px] font-bold">
              {services} · {dur(r.expectedDurationMin)}
            </div>
            <div className="truncate text-[13px] text-slate-500">
              {r.patientSnapshot?.name} · {r.patientSnapshot?.area ?? '—'}
              {r.clinical?.complaint ? ` · ${r.clinical.complaint}` : ''}
            </div>
          </div>
          <PriorityBadge priority={r.priority} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <div className="flex h-11 items-center gap-2 rounded-lg border-[1.5px] border-slate-300 px-3 text-[14px] font-semibold">
            <Calendar size={17} className="text-slate-500" /> {r.scheduledAt ? `${relDay(r.scheduledAt)}, ${dayNum(r.scheduledAt)}` : '—'}
          </div>
          <div className="flex h-11 items-center gap-2 rounded-lg border-[1.5px] border-slate-300 px-3 text-[14px] font-semibold">
            <Clock size={17} className="text-slate-500" /> {r.slot ?? (r.scheduledAt ? time(r.scheduledAt) : '—')}
          </div>
        </div>
      </MCard>
      <AssignForm
        id={id}
        requestNo={r.requestNo}
        candidates={plain(candidates)}
        need={need}
        initialTeam={team}
        initialSize={team.length || needTotal}
        instructions={r.assignment?.instructions}
        transport={!!r.transport?.needed}
      />
      </div>
    </MScreen>
  )
}
