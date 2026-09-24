import Link from 'next/link'
import { Search, Lock, NotebookPen, X } from 'lucide-react'
import { MScreen } from '@/components/mobile'
import { Avatar, Chips, Empty, Tag } from '@/components/ui'
import { SearchBox } from '@/components/coord/actions'
import { AddNoteFab, NoteMenu } from '@/components/coord/Notes'
import { requireAppUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { Note, HomecareRequest, Patient, isOid } from '@/lib/models'
import { can, ROLE_LABEL, ADMIN_ROLES, DESK_ROLES } from '@/lib/constants'
import { listNotes, visibleFilter } from '@/lib/services/notes'
import { canView } from '@/lib/services/requests'
import { time, relDay, cx } from '@/lib/format'

export const metadata = { title: 'Notes' }

const TYPE_TAG: Record<string, { label: string; tone: 'blue' | 'amber' | 'violet' | 'slate' }> = {
  PATIENT: { label: 'Patient', tone: 'blue' },
  HANDOVER: { label: 'Handover', tone: 'amber' },
  CLINICAL: { label: 'Visit', tone: 'violet' },
  GENERAL: { label: 'Personal', tone: 'slate' },
}
const VIS: Record<string, string> = { TEAM: 'Team', COORDINATOR: 'Coordinator', PRIVATE: 'Only me' }

/** M21 Notes — team notes, patient notes and handovers; M22 add sheet. ?requestId= / ?patientId= narrow the list. */
export default async function NotesPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; search?: string; requestId?: string; patientId?: string }> }) {
  const user = await requireAppUser()
  await db()
  const sp = await searchParams
  const f = sp.f ?? 'all'
  const requestId = sp.requestId && isOid(sp.requestId) ? sp.requestId : undefined
  const patientId = sp.patientId && isOid(sp.patientId) ? sp.patientId : undefined
  let ctx: { kind: 'visit' | 'patient'; id: string; label: string; sub?: string } | null = null
  if (requestId) {
    const r = await HomecareRequest.findOne({ _id: requestId, deletedAt: null }).select('requestNo patientSnapshot services assignment createdBy transport').lean<any>()
    if (r && canView(user, r)) ctx = { kind: 'visit', id: requestId, label: `${r.requestNo} · ${r.patientSnapshot?.name}`, sub: (r.services ?? []).map((s: any) => s.name).join(', ') }
  } else if (patientId) {
    const p = await Patient.findById(patientId).select('name ageYears gender uhid').lean<any>()
    if (p) ctx = { kind: 'patient', id: patientId, label: p.name, sub: [p.ageYears != null ? `${p.ageYears} ${p.gender ?? ''}`.trim() : '', p.uhid && `UHID ${p.uhid}`].filter(Boolean).join(' · ') }
  }
  const [notes, week] = await Promise.all([
    listNotes(user, { filter: f, q: sp.q, requestId: ctx?.kind === 'visit' ? requestId : undefined, patientId: ctx?.kind === 'patient' ? patientId : undefined }),
    Note.countDocuments({ ...visibleFilter(user), createdAt: { $gte: new Date(Date.now() - 7 * 86400_000) } }),
  ])
  const base = (k: string, withQ = true, extra = '') => {
    const x = new URLSearchParams()
    if (k !== 'all') x.set('f', k)
    if (withQ && sp.q) x.set('q', sp.q)
    if (extra) x.set(extra, '1')
    if (requestId) x.set('requestId', requestId)
    if (patientId) x.set('patientId', patientId)
    return `/m/notes${x.toString() ? `?${x}` : ''}`
  }
  const me = { name: user.name, initials: user.initials }
  const searching = sp.search === '1' || !!sp.q
  const isField = !DESK_ROLES.includes(user.role)
  return (
    <MScreen
      title="Notes"
      sub={`${week} note${week === 1 ? '' : 's'} this week`}
      back={ctx ? (ctx.kind === 'visit' ? (DESK_ROLES.includes(user.role) ? `/m/admin/requests/${ctx.id}` : `/m/visits/${ctx.id}`) : '/m/admin/patients') : undefined}
      right={
        <Link href={searching ? base(f, false) : base(f, true, 'search')} className="flex size-10 items-center justify-center rounded-[10px] border border-slate-200 text-slate-700" aria-label="Search notes">
          {searching ? <X size={18} /> : <Search size={18} />}
        </Link>
      }
      tab="home"
    >
      {searching && <SearchBox placeholder="Search note text" autoFocus={!sp.q} />}
      {ctx && (
        <div className="flex items-center gap-2 rounded-card bg-primary-50 px-3.5 py-2.5 text-[13px]">
          <span className="min-w-0 flex-1 truncate">
            <span className="text-slate-500">{ctx.kind === 'visit' ? 'Visit' : 'Patient'} · </span>
            <b>{ctx.label}</b>
          </span>
          <Link href="/m/notes" className="font-semibold text-primary-700">
            All notes
          </Link>
        </div>
      )}
      <Chips
        active={f}
        items={[
          { key: 'all', label: 'All', href: base('all') },
          { key: 'mine', label: 'My notes', href: base('mine') },
          { key: 'patient', label: 'Patient', href: base('patient') },
          { key: 'handover', label: 'Handover', href: base('handover') },
          { key: 'flagged', label: 'Flagged', href: base('flagged') },
        ]}
      />
      {!notes.length && <Empty icon={<NotebookPen size={26} />} title="No notes yet" sub="Handover notes, patient preferences and supply requests from the team appear here." />}
      {notes.map((n) => {
        const t = TYPE_TAG[n.type] ?? TYPE_TAG.GENERAL
        const admin = ADMIN_ROLES.includes(n.author.role as any)
        return (
          <div key={n.id} className="rounded-card bg-white px-4 py-3.5 shadow-card">
            <div className="flex items-center gap-2.5">
              <Avatar name={n.author.name} size={34} tone={admin ? 'teal' : n.author.role === 'DOCTOR' ? 'violet' : 'blue'} />
              <div className="min-w-0 flex-1 truncate text-[14px]">
                <b>{n.author.name}</b> <span className="text-[12px] text-slate-500">· {n.author.designation ?? ROLE_LABEL[n.author.role as keyof typeof ROLE_LABEL] ?? n.author.role}</span>
              </div>
              <div className="flex-none text-[12px] text-slate-400">{relDay(n.createdAt) === 'Today' ? time(n.createdAt) : relDay(n.createdAt)}</div>
              {n.mine && <NoteMenu note={{ id: n.id, type: n.type, text: n.text, tags: n.tags, visibility: n.visibility }} me={me} />}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Tag tone={t.tone}>
                {t.label}
                {n.patient && n.type !== 'HANDOVER' ? ` · ${n.patient.name}` : ''}
              </Tag>
              <Tag tone={n.visibility === 'TEAM' ? 'slate' : 'indigo'}>
                <Lock size={11} /> {VIS[n.visibility]}
              </Tag>
              {n.tags
                .filter((x: string) => x !== 'Handover')
                .map((x: string) => (
                  <Tag key={x} tone={x === 'Red flag' ? 'red' : x === 'Doctor review needed' ? 'orange' : 'slate'}>
                    {x}
                  </Tag>
                ))}
            </div>
            <div className="mt-2 whitespace-pre-line text-[15px] leading-[22px] text-slate-800">{n.text}</div>
            <div className={cx('mt-2 text-[12px] text-slate-400', !n.request && !n.edited && 'hidden')}>
              {n.request && (
                <Link href={isField ? `/m/visits/${n.request.id}` : `/m/admin/requests/${n.request.id}`} className="font-semibold text-primary-700">
                  Linked to {n.request.requestNo}
                </Link>
              )}
              {n.request && n.edited && ' · '}
              {n.edited && 'edited'}
            </div>
          </div>
        )
      })}
      <div className="h-16" aria-hidden />
      <AddNoteFab me={me} link={ctx} canSearchPatients={can(user, 'requests.create')} allVisits={can(user, 'requests.readAll')} />
    </MScreen>
  )
}

