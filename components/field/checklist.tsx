'use client'
// M08 Checklist (M08-e "by the book"): 28px boxes, mandatory star, stamped time pill, note link, optimistic ticks.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, CheckCircle2, Plus, Loader2, HeartPulse, FileText, Camera, PenLine, LogIn } from 'lucide-react'
import { api, stamp, useToast, Sheet } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx, time } from '@/lib/format'
import { sendOrQueue } from './live'
import { BottomBar, CHeader, TimerPill, Body, bigBtn } from './bar'

type Item = { key: string; label: string; mandatory?: boolean; adHoc?: boolean; done?: boolean; doneAt?: string; note?: string; untickReason?: string }
const UNTICK = ['Ticked by mistake', 'Not done after all', 'Patient refused', 'Other']

export function ChecklistScreen({
  id,
  items: initial,
  title,
  sub,
  editable,
  status,
  checkInAt,
  vitalsLine,
  medsLine,
  vitalsAt,
  photos,
  confirmed,
}: {
  id: string
  items: Item[]
  title: string
  sub: string
  editable: boolean
  status: string
  checkInAt?: string
  vitalsLine?: string
  medsLine?: string
  vitalsAt?: string
  photos: number
  confirmed: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [items, setItems] = useState<Item[]>(initial)
  const sig = JSON.stringify(initial)
  useEffect(() => {
    setItems(JSON.parse(sig))
  }, [sig])
  const [untick, setUntick] = useState<Item | null>(null)
  const [reason, setReason] = useState(UNTICK[0])
  const [reasonNote, setReasonNote] = useState('')
  const [noteFor, setNoteFor] = useState<Item | null>(null)
  const [noteText, setNoteText] = useState('')
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const s = useMemo(() => {
    const mand = items.filter((i) => i.mandatory)
    return { done: items.filter((i) => i.done).length, total: items.length, mand: mand.length, mandDone: mand.filter((i) => i.done).length }
  }, [items])
  const left = s.mand - s.mandDone
  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)))

  async function send(it: Item, body: Record<string, unknown>, rollback: Partial<Item>, label: string) {
    try {
      const r = await sendOrQueue(`/requests/${id}/checklist/${encodeURIComponent(it.key)}`, body, { method: 'PATCH', label: `${label} · ${it.label}` })
      if (r.queued) toast(`Saved offline · ${it.label}`, 'info')
      else router.refresh()
    } catch (e: any) {
      patch(it.key, rollback)
      toast(e.message, 'err')
    }
  }

  function tick(it: Item) {
    if (!editable) return
    if (it.done) {
      setReason(UNTICK[0])
      setReasonNote('')
      setUntick(it)
      return
    }
    const st = stamp()
    patch(it.key, { done: true, doneAt: st.deviceAt })
    send(it, { done: true, ...st }, { done: false, doneAt: undefined }, 'Tick')
  }

  const vitalsItem = (it: Item) => /vital|^bp$|^rbs$|spo|pain/i.test(it.key)
  const medItem = (it: Item) => /medic|administer/i.test(it.key)

  const row = (it: Item, first: boolean) => {
    const hint = it.note || (vitalsItem(it) ? vitalsLine : medItem(it) ? medsLine : undefined)
    return (
      <div key={it.key} className={cx('flex min-h-16 items-center gap-3.5 px-4 py-3.5', !first && 'border-t border-slate-100', editable && it.mandatory && !it.done && 'bg-[#FFFBEB]')}>
        <button
          type="button"
          onClick={() => tick(it)}
          disabled={!editable}
          aria-label={it.done ? `Untick ${it.label}` : `Tick ${it.label}`}
          className={cx('-m-2.5 flex size-12 flex-none items-center justify-center', !editable && 'cursor-default')}
        >
          <span className={cx('flex size-7 items-center justify-center rounded-lg', it.done ? 'bg-primary text-white' : 'border-2 border-slate-300 bg-white')}>{it.done && <Check size={18} strokeWidth={3} />}</span>
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => tick(it)} disabled={!editable} className={cx('block text-left text-[15px] font-semibold', it.done && 'text-slate-500 line-through')}>
            {it.label}
            {it.mandatory && <span className="inline-block pl-1 text-[#DC2626] no-underline">*</span>}
            {it.adHoc && <span className="ml-1.5 inline-block rounded bg-slate-100 px-1 text-[10px] font-bold uppercase text-slate-500 no-underline">ad hoc</span>}
          </button>
          {hint && <div className="mt-0.5 text-[12px] text-slate-500">{hint}</div>}
          {!it.done && it.untickReason && <div className="mt-0.5 text-[12px] text-[#B45309]">Unticked: {it.untickReason}</div>}
          {editable && vitalsItem(it) && !vitalsAt ? (
            <Link href={`/m/visits/${id}/vitals`} className="mt-0.5 inline-block text-[12px] font-semibold text-primary-700">
              Record vitals →
            </Link>
          ) : (
            editable && (
              <button
                type="button"
                onClick={() => {
                  setNoteText(it.note ?? '')
                  setNoteFor(it)
                }}
                className="mt-0.5 block py-0.5 text-[12px] font-semibold text-primary-700"
              >
                {it.note ? 'Edit note' : 'Add note'}
              </button>
            )
          )}
        </div>
        {it.done && it.doneAt ? (
          <span className="inline-flex h-[26px] flex-none items-center rounded-full bg-slate-100 px-2.5 text-[13px] font-bold text-slate-700">{time(it.doneAt)}</span>
        ) : (
          <span className="flex-none text-[13px] text-slate-400">—</span>
        )}
      </div>
    )
  }

  const mandatory = items.filter((i) => i.mandatory)
  const optional = items.filter((i) => !i.mandatory)
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0

  return (
    <div className="min-w-0">
      <CHeader
        back={`/m/visits/${id}`}
        title={title}
        sub={sub}
        right={status === 'IN_PROGRESS' ? <TimerPill from={checkInAt} /> : null}
        below={
          <div className="mx-2 mt-3">
            <div className="mb-1.5 flex justify-between text-[13px] font-semibold">
              <span>
                {s.done} of {s.total} done
              </span>
              <span className="text-slate-500">
                {s.mandDone} of {s.mand} mandatory
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={cx('h-full rounded-full transition-all', left ? 'bg-primary' : 'bg-[#16A34A]')} style={{ width: `${pct}%` }} />
            </div>
          </div>
        }
      />
      <Body>
        {!editable && ['ACCEPTED', 'EN_ROUTE', 'ASSIGNED'].includes(status) && (
          <Link href={`/m/visits/${id}/checkin`} className="flex items-center gap-3 rounded-card bg-primary-50 px-4 py-3 text-[14px] font-semibold text-primary-700">
            <LogIn size={18} /> Check in to start ticking the checklist
          </Link>
        )}
        {editable && !left && s.mand > 0 && (
          <div className="flex items-center gap-2.5 rounded-card bg-[#DCFCE7] px-4 py-3 text-[14px] font-semibold text-[#15803D]">
            <CheckCircle2 size={18} /> All mandatory items done · you can check out
          </div>
        )}
        {mandatory.length > 0 && (
          <>
            <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Mandatory</div>
            <div className="overflow-hidden rounded-card bg-white shadow-card">
              {mandatory.map((it, i) => row(it, i === 0))}
            </div>
          </>
        )}
        <div className="mt-2 text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Optional</div>
        <div className="overflow-hidden rounded-card bg-white shadow-card">
          {optional.map((it, i) => row(it, i === 0))}
          {editable && (
            <button type="button" onClick={() => (setLabel(''), setAdding(true))} className={cx('flex min-h-14 w-full items-center gap-2.5 px-4 text-[14px] font-semibold text-primary-700', optional.length > 0 && 'border-t border-slate-100')}>
              <Plus size={18} /> Add ad-hoc item
            </button>
          )}
          {!editable && !optional.length && <div className="px-4 py-3.5 text-[13px] text-slate-400">No optional items</div>}
        </div>

        <div className="mt-2 text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Record</div>
        <div className="grid grid-cols-4 gap-2">
          {[
            { href: 'vitals', icon: HeartPulse, label: 'Vitals', done: !!vitalsAt },
            { href: 'notes', icon: FileText, label: 'Notes', done: !!medsLine },
            { href: 'photos', icon: Camera, label: photos ? `Photos · ${photos}` : 'Photos', done: photos > 0 },
            { href: 'confirm', icon: PenLine, label: 'Confirm', done: confirmed },
          ].map((q) => (
            <Link key={q.href} href={`/m/visits/${id}/${q.href}`} className="relative flex flex-col items-center gap-1.5 rounded-card bg-white px-1 py-3 shadow-card active:bg-slate-50">
              <span className={cx('flex size-9 items-center justify-center rounded-[10px]', q.done ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-primary-50 text-primary-700')}>
                <q.icon size={18} />
              </span>
              <span className="text-center text-[11.5px] font-semibold leading-[14px] text-slate-700">{q.label}</span>
              {q.done && <Check size={14} strokeWidth={3} className="absolute right-2 top-2 text-[#16A34A]" />}
            </Link>
          ))}
        </div>
      </Body>

      <BottomBar note={editable && left ? `${left} mandatory item${left === 1 ? '' : 's'} left before check-out` : undefined}>
        {editable ? (
          left ? (
            <span className={bigBtn('d')}>Continue to check-out</span>
          ) : (
            <Link href={`/m/visits/${id}/checkout`} className={bigBtn('g')}>
              Continue to check-out
            </Link>
          )
        ) : (
          <Link href={`/m/visits/${id}`} className={bigBtn('o')}>
            Back to visit
          </Link>
        )}
      </BottomBar>

      {/* untick reason */}
      <Sheet
        open={!!untick}
        onClose={() => setUntick(null)}
        title="Untick item?"
        sub={untick ? `${untick.label}${untick.doneAt ? ` · ticked ${time(untick.doneAt)}` : ''}. The reason is kept on the record.` : ''}
        footer={
          <>
            <button type="button" className={bigBtn('o')} onClick={() => setUntick(null)}>
              Keep ticked
            </button>
            <button
              type="button"
              className={bigBtn('r')}
              onClick={() => {
                const it = untick!
                const why = reason === 'Other' ? reasonNote || 'Other' : reasonNote ? `${reason} · ${reasonNote}` : reason
                setUntick(null)
                patch(it.key, { done: false, doneAt: undefined, untickReason: why })
                send(it, { done: false, reason: why, ...stamp() }, { done: true, doneAt: it.doneAt, untickReason: it.untickReason }, 'Untick')
              }}
            >
              Untick
            </button>
          </>
        }
      >
        <div className="flex flex-wrap gap-2">
          {UNTICK.map((x) => (
            <button key={x} type="button" onClick={() => setReason(x)} className={cx('h-9 rounded-full px-3.5 text-[13px] font-semibold', x === reason ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}>
              {x}
            </button>
          ))}
        </div>
        <input className="hc-input hc-input-lg mt-3" placeholder={reason === 'Other' ? 'Reason (required)' : 'Add detail (optional)'} value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} />
        <div className="h-2" />
      </Sheet>

      {/* note */}
      <Sheet
        open={!!noteFor}
        onClose={() => setNoteFor(null)}
        title={noteFor ? `Note · ${noteFor.label}` : ''}
        sub="Short, factual; visible to the care team and coordinator"
        footer={
          <button
            type="button"
            disabled={busy}
            className={bigBtn('p')}
            onClick={async () => {
              const it = noteFor!
              setBusy(true)
              const prev = it.note
              patch(it.key, { note: noteText })
              // keep the original tick time: resend it as the device time
              await send(it, { done: !!it.done, note: noteText, ...(it.done && it.doneAt ? { deviceAt: it.doneAt } : {}) }, { note: prev }, 'Note')
              setBusy(false)
              setNoteFor(null)
            }}
          >
            {busy && <Loader2 size={18} className="animate-spin" />}
            Save note
          </button>
        }
      >
        <textarea autoFocus className="hc-input min-h-[110px] text-[15px]" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. Sacral area intact, no redness" />
        <div className="h-2" />
      </Sheet>

      {/* ad-hoc */}
      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add ad-hoc item"
        sub="Something done that is not on the service checklist"
        footer={
          <button
            type="button"
            disabled={busy || label.trim().length < 2}
            className={bigBtn('p')}
            onClick={async () => {
              setBusy(true)
              try {
                await api(`/requests/${id}/checklist-add`, { body: { label: label.trim() } })
                toast('Item added', 'ok')
                setAdding(false)
                router.refresh()
              } catch (e: any) {
                toast(e.message, 'err')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <Loader2 size={18} className="animate-spin" />}
            Add item
          </button>
        }
      >
        <input autoFocus className="hc-input hc-input-lg" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Nebulisation given" />
        <div className="h-2" />
      </Sheet>
    </div>
  )
}
