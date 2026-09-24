'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BOARD_COLUMNS, type Status } from '@/lib/constants'
import { Clock, ExternalLink, MoreVertical, UserPlus } from 'lucide-react'
import { Avatar, PriorityBadge, SlaPill, StatusChip } from '@/components/ui'
import { Elapsed, useToast, WhatsAppButton } from '@/components/client'
import { cx } from '@/lib/format'
import { downloadCsv } from './csv'
import type { BoardRow } from './types'

const COLS = '36px 140px minmax(0,1.3fr) minmax(0,1.2fr) 100px 130px 130px minmax(0,1.2fr) 160px 56px'

/** Patient WhatsApp template that fits where the request is in its lifecycle. */
function waTemplate(status: string) {
  return (
    {
      CONFIRMED: 'patient_confirmed',
      RESCHEDULED: 'patient_rescheduled',
      ASSIGNED: 'patient_assigned',
      ACCEPTED: 'patient_assigned',
      EN_ROUTE: 'patient_en_route',
      IN_PROGRESS: 'patient_arrived',
      COMPLETED: 'patient_completed',
      CLOSED: 'patient_completed',
      CANCELLED: 'patient_cancelled',
    } as Record<string, string>
  )[status]
}

/** W03-b table view: bulk select, row actions and CSV export of the loaded rows. */
export function RequestsTable({ rows: loaded, canAssign, canMessage }: { rows: BoardRow[]; canAssign: boolean; canMessage: boolean }) {
  // lifecycle order (as the Kanban columns), then by schedule as loaded
  const rows = useMemo(() => {
    const col = (s: string) => BOARD_COLUMNS.findIndex((c) => c.statuses.includes(s as Status))
    return loaded.map((r, i) => ({ r, i })).sort((a, b) => col(a.r.status) - col(b.r.status) || a.i - b.i).map((x) => x.r)
  }, [loaded])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const router = useRouter()
  const toast = useToast()
  // drop selections that are no longer on screen after a refresh / filter change
  useEffect(() => setSel((s) => new Set([...s].filter((id) => rows.some((r) => r.id === id)))), [rows])
  const all = rows.length > 0 && sel.size === rows.length
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const chosen = rows.filter((r) => sel.has(r.id))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-0 flex-1 overflow-auto rounded-card bg-white shadow-card">
        <div className="min-w-[1020px]">
          <div className="sticky top-0 z-10 grid h-11 items-center border-b border-slate-200 bg-slate-50 px-5 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500" style={{ gridTemplateColumns: COLS }}>
            <div className="pr-3">
              <Check on={all} onClick={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} label="Select all" />
            </div>
            {['Request', 'Patient', 'Service', 'Priority', 'Status', 'Schedule', 'Staff', 'SLA', ''].map((h, i) => (
              <div key={i} className="truncate pr-3">
                {h}
              </div>
            ))}
          </div>
          {rows.length === 0 && <div className="px-5 py-16 text-center text-sm text-slate-400">No requests match these filters</div>}
          {rows.map((r) => (
            <div
              key={r.id}
              className={cx('grid h-[52px] cursor-pointer items-center border-b border-slate-100 px-5 text-[13px] hover:bg-slate-50', sel.has(r.id) && 'bg-primary-50 hover:bg-primary-50')}
              style={{ gridTemplateColumns: COLS }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('a,button,[data-stop]')) return
                router.push(`/requests/${r.id}`)
              }}
            >
              <div className="pr-3" data-stop>
                <Check on={sel.has(r.id)} onClick={() => toggle(r.id)} label={`Select ${r.requestNo}`} />
              </div>
              <div className="truncate pr-3 font-bold">
                <Link href={`/requests/${r.id}`} className="hover:text-primary-700">
                  {r.requestNo}
                </Link>
              </div>
              <div className="flex min-w-0 items-center gap-2 pr-3">
                <Avatar name={r.patient} size={28} />
                <div className="min-w-0">
                  <div className="truncate font-semibold">
                    {r.patient} <span className="font-normal text-slate-500">{r.ageGender}</span>
                  </div>
                  <div className="truncate text-[12px] text-slate-500">{r.area || '—'}</div>
                </div>
              </div>
              <div className="truncate pr-3" title={r.services}>
                {r.services}
              </div>
              <div className="pr-3">
                <PriorityBadge priority={r.priority} />
              </div>
              <div className="pr-3">
                <StatusChip status={r.status} sm />
              </div>
              <div className="truncate pr-3">{r.schedule}</div>
              <div className="flex min-w-0 items-center gap-2 pr-3">
                {r.staff ? (
                  <>
                    <Avatar name={r.staff.name} size={24} />
                    <span className="truncate" title={r.staff.name}>
                      {r.staff.short}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-400">Unassigned</span>
                )}
              </div>
              <div className="min-w-0 pr-3">
                {r.checkInAt ? (
                  <span className={cx('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-bold', r.sla?.tone === 'r' ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#FEF3C7] text-[#B45309]')}>
                    <Clock size={12} strokeWidth={2.5} />
                    Elapsed <Elapsed from={r.checkInAt} />
                  </span>
                ) : (
                  r.sla && <SlaPill tone={r.sla.tone} label={r.sla.label} />
                )}
              </div>
              <div data-stop>
                <RowMenu r={r} canAssign={canAssign} canMessage={canMessage} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-slate-500">
        <span>
          {sel.size ? (
            <>
              {sel.size} selected ·{' '}
              {canAssign && (
                <>
                  <button
                    type="button"
                    className="font-semibold text-primary-700 hover:underline"
                    onClick={() => {
                      if (chosen.length !== 1) return toast('Assign one request at a time — select a single row', 'info')
                      router.push(`/requests/${chosen[0].id}?assign=1`)
                    }}
                  >
                    Assign
                  </button>{' '}
                  ·{' '}
                </>
              )}
              <button type="button" className="font-semibold text-primary-700 hover:underline" onClick={() => downloadCsv(chosen, 'requests-selected')}>
                Export CSV
              </button>{' '}
              ·{' '}
              <button type="button" className="font-semibold text-slate-600 hover:underline" onClick={() => setSel(new Set())}>
                Clear
              </button>
            </>
          ) : (
            <>
              Select rows for bulk actions ·{' '}
              <button type="button" className="font-semibold text-primary-700 hover:underline" onClick={() => downloadCsv(rows)} disabled={!rows.length}>
                Export CSV
              </button>
            </>
          )}
        </span>
        <span>
          Showing {rows.length} of {rows.length}
        </span>
      </div>
    </div>
  )
}

function Check({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cx('flex size-4 items-center justify-center rounded-md border-2', on ? 'border-primary bg-primary' : 'border-slate-300 bg-white')}
    >
      {on && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </button>
  )
}

/** Row action menu. Kept mounted (only hidden) so the WhatsApp "did you send it?" dialog survives. */
function RowMenu({ r, canAssign, canMessage }: { r: BoardRow; canAssign: boolean; canMessage: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [open])
  const tpl = waTemplate(r.status)
  const assignable = ['CONFIRMED', 'RESCHEDULED', 'ASSIGNED', 'ACCEPTED'].includes(r.status)
  const item = 'flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] font-semibold text-slate-700 hover:bg-slate-100'
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Actions for ${r.requestNo}`} aria-expanded={open} className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50">
        <MoreVertical size={16} />
      </button>
      <div className={cx('absolute right-0 top-9 z-20 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg', !open && 'hidden')}>
        <Link href={`/requests/${r.id}`} className={item}>
          <ExternalLink size={15} /> Open
        </Link>
        {canAssign && assignable && (
          <Link href={`/requests/${r.id}?assign=1`} className={item}>
            <UserPlus size={15} /> {r.staff ? 'Reassign' : 'Assign'}
          </Link>
        )}
        {canMessage && (
          <WhatsAppButton
            requestId={r.id}
            templateKey={tpl}
            text={tpl ? undefined : `Hello ${r.patient}, this is Unico Hospitals Home Care about your request ${r.requestNo}. `}
            kind="ghost"
            size="sm"
            className="w-full justify-start px-2.5"
          >
            WhatsApp patient
          </WhatsAppButton>
        )}
      </div>
    </div>
  )
}
