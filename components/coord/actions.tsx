'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Search, X } from 'lucide-react'
import { api, useAction, Sheet } from '@/components/client'
import { SLOTS } from '@/lib/constants'
import { cx, isoDay } from '@/lib/format'
import { abtn, bbtn, type AKind } from './ui'

/** POSTs to the API with the mobile card-button look; toasts and refreshes. */
export function PostButton({
  path,
  body,
  method = 'POST',
  kind = 'p',
  big,
  className,
  success,
  confirm,
  redirect,
  children,
  disabled,
}: {
  path: string
  body?: unknown
  method?: string
  kind?: AKind
  big?: boolean
  className?: string
  success?: string
  confirm?: string
  redirect?: string
  children: ReactNode
  disabled?: boolean
}) {
  const { run, busy } = useAction()
  return (
    <button
      type="button"
      disabled={busy || disabled}
      className={(big ? bbtn : abtn)(kind, className)}
      onClick={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (confirm && !window.confirm(confirm)) return
        await run(() => api(path, { method, body: body ?? {} }), success, { redirect })
      }}
    >
      {busy && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  )
}

const CANCEL_REASONS = ['Patient postponed', 'Patient unreachable', 'Duplicate request', 'Service not available', 'Admitted to hospital', 'Other']

/** Cancel with a reason sheet (M17 quick action / coordinator view) */
export function CancelRequestButton({ id, requestNo, kind = 'o', big, className, label = 'Cancel', redirect }: { id: string; requestNo?: string; kind?: AKind; big?: boolean; className?: string; label?: string; redirect?: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const { run, busy } = useAction()
  const text = reason === 'Other' ? note.trim() : [reason, note.trim()].filter(Boolean).join(' · ')
  return (
    <>
      <button type="button" className={(big ? bbtn : abtn)(kind, className)} onClick={(e) => (e.preventDefault(), e.stopPropagation(), setOpen(true))}>
        {label}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Cancel request?"
        sub={`${requestNo ?? ''} · the patient, team and driver are told`}
        footer={
          <>
            <button className={bbtn('o', 'flex-1')} onClick={() => setOpen(false)}>
              Keep
            </button>
            <button
              className={bbtn('r', 'flex-[1.4] border-0 bg-[#DC2626] text-white')}
              disabled={busy || text.length < 2}
              onClick={async () => {
                const r = await run(() => api(`/requests/${id}/cancel`, { body: { reason: text } }), 'Request cancelled', { redirect })
                if (r) setOpen(false)
              }}
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              Cancel request
            </button>
          </>
        }
      >
        <div className="text-[13px] font-semibold text-slate-700">Reason</div>
        <div className="mt-2 grid gap-2">
          {CANCEL_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={cx('flex h-12 items-center gap-3 rounded-xl border-[1.5px] px-4 text-left text-[15px] font-semibold', reason === r ? 'border-primary bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-700')}
            >
              <span className={cx('flex size-5 flex-none items-center justify-center rounded-full border-2', reason === r ? 'border-primary' : 'border-slate-300')}>{reason === r && <span className="size-2.5 rounded-full bg-primary" />}</span>
              {r}
            </button>
          ))}
        </div>
        <textarea className="hc-input hc-input-lg mt-3 h-20 py-2.5" placeholder={reason === 'Other' ? 'Tell us why (required)' : 'Note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} />
      </Sheet>
    </>
  )
}

/** Reschedule sheet — new date + slot + reason; the request goes back to CONFIRMED and needs re-assignment */
export function RescheduleButton({ id, requestNo, date, slot, kind = 'o', className, big }: { id: string; requestNo?: string; date?: string; slot?: string; kind?: AKind; className?: string; big?: boolean }) {
  const [open, setOpen] = useState(false)
  const [d, setD] = useState(date ?? isoDay())
  const [s, setS] = useState(slot ?? '')
  const [t, setT] = useState('')
  const [reason, setReason] = useState('')
  const { run, busy } = useAction()
  return (
    <>
      <button type="button" className={(big ? bbtn : abtn)(kind, className)} onClick={() => setOpen(true)}>
        Reschedule
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Reschedule visit"
        sub={`${requestNo ?? ''} · the team is released and must be re-assigned`}
        footer={
          <>
            <button className={bbtn('o', 'flex-1')} onClick={() => setOpen(false)}>
              Back
            </button>
            <button
              className={bbtn('p', 'flex-[1.4]')}
              disabled={busy || reason.trim().length < 2 || !d}
              onClick={async () => {
                const r = await run(() => api(`/requests/${id}/reschedule`, { body: { date: d, slot: s || undefined, time: t || undefined, reason: reason.trim() } }), 'Visit rescheduled')
                if (r) setOpen(false)
              }}
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              Reschedule
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-slate-700">New date</div>
            <input type="date" className="hc-input hc-input-lg" value={d} min={isoDay()} onChange={(e) => setD(e.target.value)} />
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-slate-700">Time</div>
            <input type="time" className="hc-input hc-input-lg" value={t} onChange={(e) => setT(e.target.value)} />
          </div>
        </div>
        <div className="mb-1.5 mt-3 text-[13px] font-semibold text-slate-700">Slot</div>
        <div className="grid grid-cols-4 gap-2">
          {SLOTS.map((x) => (
            <button key={x} type="button" onClick={() => setS(s === x ? '' : x)} className={cx('h-11 rounded-[10px] text-sm font-bold', s === x ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-700')}>
              {x}
            </button>
          ))}
        </div>
        <div className="mb-1.5 mt-3 text-[13px] font-semibold text-slate-700">
          Reason <span className="text-[#DC2626]">*</span>
        </div>
        <textarea className="hc-input hc-input-lg h-20 py-2.5" placeholder="e.g. Patient asked for the evening" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Sheet>
    </>
  )
}

/** Debounced search box that writes ?q= into the URL (server page re-queries) */
export function SearchBox({ placeholder, param = 'q', autoFocus }: { placeholder: string; param?: string; autoFocus?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [v, setV] = useState(sp.get(param) ?? '')
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (t.current) clearTimeout(t.current)
    t.current = setTimeout(() => {
      const next = new URLSearchParams(sp.toString())
      if (v.trim()) next.set(param, v.trim())
      else next.delete(param)
      router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false })
    }, 300)
    return () => {
      if (t.current) clearTimeout(t.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v])
  return (
    <label className="flex h-12 items-center gap-2 rounded-[10px] border-[1.5px] border-slate-300 bg-white px-3 focus-within:border-primary">
      <Search size={20} className="flex-none text-slate-400" />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} inputMode="search" className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400" />
      {v && (
        <button type="button" onClick={() => setV('')} className="flex size-7 items-center justify-center rounded-full text-slate-400" aria-label="Clear">
          <X size={16} />
        </button>
      )}
    </label>
  )
}
