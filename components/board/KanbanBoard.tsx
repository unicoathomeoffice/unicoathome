'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type DragEvent } from 'react'
import { Clock, GripVertical, Loader2, Plus } from 'lucide-react'
import { Avatar, PriorityBadge, SlaPill, StatusChip } from '@/components/ui'
import { api, Elapsed, useToast } from '@/components/client'
import { BOARD_COLUMNS, STATUS_COLORS, type Status } from '@/lib/constants'
import { cx } from '@/lib/format'
import type { BoardRow } from './types'

type Col = (typeof BOARD_COLUMNS)[number]

/**
 * W03-a Kanban. Cards can be dragged between columns (HTML5 DnD) by users who can manage requests.
 * A drop runs the matching lifecycle action only when it needs no extra input; otherwise it opens the
 * request detail (confirm needs a date, assign needs staff, close needs the invoice).
 */
export function KanbanBoard({ rows, canManage, canAssign, canCreate }: { rows: BoardRow[]; canManage: boolean; canAssign: boolean; canCreate: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [drag, setDrag] = useState<BoardRow | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function act(r: BoardRow, action: string, body: unknown, ok: string) {
    setBusy(r.id)
    try {
      await api(`/requests/${r.id}/${action}`, { body })
      toast(ok, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e?.code === 'INVALID_TRANSITION' ? `${r.short}: ${e.message}` : (e?.message ?? 'Something went wrong'), 'err')
    } finally {
      setBusy(null)
    }
  }

  function go(r: BoardRow, href: string, msg: string) {
    toast(msg, 'info')
    router.push(href)
  }

  async function drop(r: BoardRow, col: Col) {
    const s = r.status as Status
    const from = BOARD_COLUMNS.find((c) => c.statuses.includes(s))
    if (col.key === 'new') {
      if (s === 'NEW') return act(r, 'verify', {}, `${r.short} verified`)
      if (from?.key !== 'new') toast(`${r.short} cannot go back to New`, 'err')
      return
    }
    if (from?.key === col.key) return
    switch (col.key) {
      case 'confirmed':
        if (s === 'NEW' || s === 'VERIFIED') {
          if (r.hasSchedule) return act(r, 'confirm', {}, `${r.short} confirmed`)
          return go(r, `/requests/${r.id}`, `Set the date and time to confirm ${r.short}`)
        }
        return toast(`${r.short} is already ${s.toLowerCase().replace('_', ' ')} — use Reassign or Reschedule on the request`, 'err')
      case 'assigned':
        if (!canAssign) return toast('You do not have permission to assign staff', 'err')
        if (['CONFIRMED', 'RESCHEDULED'].includes(s)) return go(r, `/requests/${r.id}?assign=1`, `Pick the staff to assign ${r.short}`)
        if (s === 'NEW' || s === 'VERIFIED') return go(r, `/requests/${r.id}`, `Confirm ${r.short} (date and time) before assigning`)
        return toast(`${r.short} cannot move back to Assigned`, 'err')
      case 'progress':
      case 'completed':
        return toast(`The care team starts and completes visits from the app — ${r.short} cannot be moved there`, 'err')
      case 'closed':
        if (s === 'COMPLETED') return go(r, `/requests/${r.id}`, `Add the invoice to close ${r.short}`)
        if (s === 'EN_ROUTE' || s === 'IN_PROGRESS') return toast(`${r.short} is ${s === 'EN_ROUTE' ? 'en route' : 'in progress'} and cannot be cancelled`, 'err')
        {
          const reason = window.prompt(`Cancel ${r.requestNo} (${r.patient})?\nReason for cancelling:`)
          if (reason == null) return
          if (reason.trim().length < 2) return toast('A cancel reason is required', 'err')
          return act(r, 'cancel', { reason: reason.trim() }, `${r.short} cancelled`)
        }
    }
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[repeat(6,minmax(170px,1fr))] gap-3 overflow-x-auto pb-1">
      {BOARD_COLUMNS.map((col) => {
        const items = rows.filter((r) => col.statuses.includes(r.status as Status))
        const isOver = over === col.key && drag
        return (
          <section
            key={col.key}
            aria-label={col.label}
            className={cx('flex min-h-0 flex-col gap-2 rounded-card bg-[#E9EEF3] p-2.5 transition', isOver && 'bg-primary-50 ring-2 ring-primary/40')}
            onDragOver={(e: DragEvent) => {
              if (!drag) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (over !== col.key) setOver(col.key)
            }}
            onDragLeave={(e: DragEvent) => {
              if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver((o) => (o === col.key ? null : o))
            }}
            onDrop={(e: DragEvent) => {
              e.preventDefault()
              const r = drag
              setDrag(null)
              setOver(null)
              if (r) drop(r, col)
            }}
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-1.5 pt-0.5">
              <div className="text-[12px] font-bold uppercase tracking-[.04em] text-slate-700">{col.label}</div>
              <div className="rounded-full bg-white px-2 py-px text-[12px] font-bold text-slate-500">{items.length}</div>
            </div>
            <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-1">
              {items.map((r) => (
                <KanbanCard
                  key={r.id}
                  r={r}
                  col={col}
                  draggable={canManage}
                  busy={busy === r.id}
                  dragging={drag?.id === r.id}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', r.id)
                    setDrag(r)
                  }}
                  onDragEnd={() => {
                    setDrag(null)
                    setOver(null)
                  }}
                />
              ))}
              {!items.length && <div className="rounded-[10px] border-[1.5px] border-dashed border-slate-300 px-2 py-5 text-center text-[12px] text-slate-400">{col.key === 'closed' ? 'Nothing in the last 3 days' : 'No requests'}</div>}
              {col.key === 'new' && canCreate && (
                <Link href="/requests/new" className="flex h-10 flex-none items-center justify-center gap-1.5 rounded-[10px] border-[1.5px] border-dashed border-slate-300 text-[12px] font-semibold text-slate-500 hover:border-primary hover:text-primary-700">
                  <Plus size={14} /> New request
                </Link>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function KanbanCard({
  r,
  col,
  draggable,
  busy,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  r: BoardRow
  col: Col
  draggable: boolean
  busy: boolean
  dragging: boolean
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
}) {
  const live = r.status === 'IN_PROGRESS' || r.status === 'EN_ROUTE'
  const showChip = r.status !== col.statuses[0] || col.key === 'progress' || col.key === 'completed'
  return (
    <Link
      href={`/requests/${r.id}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cx('relative block flex-none rounded-[10px] bg-white p-3 shadow-card transition hover:shadow-md', live && 'border-[1.5px]', dragging && 'opacity-40', busy && 'pointer-events-none opacity-60')}
      style={live ? { borderColor: STATUS_COLORS[r.status as Status][2] } : undefined}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500">
          {draggable && <GripVertical size={12} className="-ml-0.5 cursor-grab text-slate-300" aria-hidden />}
          {r.short}
        </div>
        <PriorityBadge priority={r.priority} />
      </div>
      <div className="mt-2 truncate text-sm font-semibold">
        {r.patient} {r.ageGender && <span className="text-[12px] font-normal text-slate-500">{r.ageGender}</span>}
      </div>
      <div className="mt-px truncate text-[12px] text-slate-500">{[r.services, r.area].filter(Boolean).join(' · ')}</div>
      <div className="mt-2.5 flex flex-col items-start gap-1.5">
        <div className="flex min-w-0 max-w-full items-center gap-1.5 text-[12px] text-slate-700">
          {r.staff ? (
            <>
              <Avatar name={r.staff.name} size={22} />
              <span className="truncate" title={r.staff.name}>
                {r.schedule}
              </span>
            </>
          ) : (
            <span className="truncate text-slate-400">{r.schedule}</span>
          )}
        </div>
        {r.checkInAt ? (
          <span className={cx('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-bold', r.sla?.tone === 'r' ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#FEF3C7] text-[#B45309]')}>
            <Clock size={12} strokeWidth={2.5} />
            Elapsed <Elapsed from={r.checkInAt} />
          </span>
        ) : (
          r.sla && (
            <div className="flex max-w-full overflow-hidden rounded-full" title={r.sla.label}>
              <SlaPill tone={r.sla.tone} label={r.sla.label} />
            </div>
          )
        )}
      </div>
      {showChip && (
        <div className="mt-2">
          <StatusChip status={r.status} sm />
        </div>
      )}
      {busy && <Loader2 size={16} className="absolute right-3 top-3 animate-spin text-primary" />}
    </Link>
  )
}
