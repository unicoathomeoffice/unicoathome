'use client'
// "Notify on WhatsApp" — shown on every action that sends WhatsApp (create, confirm, assign, reschedule, cancel,
// car allotted). Lists who would get a message with the Settings defaults ticked; the action then sends only to the
// ticked people (`notify: keys` in its body). Steps nobody clicks keep the Settings defaults (lib/services/notify.ts).
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, MessageCircle } from 'lucide-react'
import { api } from '@/components/client'
import { cx, phone as fmtPhone } from '@/lib/format'

export type NotifyEvent = 'NEW_REQUEST' | 'CONFIRMED' | 'ASSIGNED' | 'RESCHEDULED' | 'CANCELLED' | 'CAR_ALLOTTED'
export type NotifyParams = {
  events: NotifyEvent[]
  requestId?: string
  serviceCodes?: string[]
  patient?: { name?: string; phone?: string }
  transportNeeded?: boolean
  staffIds?: string[]
  vehicleId?: string
  driverId?: string
}
type Item = { key: string; kind: 'patient' | 'staff' | 'driver' | 'supervisor' | 'group'; name: string; role: string; phone: string; group?: string; defaultOn: boolean; note?: string; what: string[] }

const KIND_TITLE: Record<Exclude<Item['kind'], 'group'>, string> = { patient: 'Patient', staff: 'Care team', driver: 'Driver', supervisor: 'Security supervisor' }

/**
 * `value` null until the list has loaded (send `notify: value ?? undefined` — undefined means the Settings defaults).
 * `params` null hides the picker (e.g. nothing chosen yet).
 */
export function NotifyPicker({
  params,
  value,
  onChange,
  onPaired,
  preview,
  className,
}: {
  params: NotifyParams | null
  value: string[] | null
  onChange: (keys: string[] | null) => void
  /** whether the hospital WhatsApp is paired (messages go out by themselves) */
  onPaired?: (paired: boolean) => void
  /** existing request: "Preview patient message" for this template (date/slot override the request's) */
  preview?: { templateKey: string; date?: string; slot?: string }
  className?: string
}) {
  const [data, setData] = useState<{ paired: boolean; items: Item[] } | null>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const ask = useMemo(() => (params ? JSON.stringify(params) : ''), [params])
  const valueRef = useRef(value)
  valueRef.current = value
  const seen = useRef<Set<string>>(new Set()) // keys already offered: a person's untick survives a refresh

  useEffect(() => {
    if (!ask) return
    let live = true
    const t = setTimeout(() => {
      api<{ paired: boolean; items: Item[] }>('/notify/preview', { body: JSON.parse(ask) })
        .then((d) => {
          if (!live) return
          setData(d)
          setErr(null)
          onPaired?.(d.paired)
          const prev = new Set(valueRef.current ?? [])
          const next = d.items.filter((i) => !i.note || i.kind !== 'patient').filter((i) => (seen.current.has(i.key) ? prev.has(i.key) : i.defaultOn)).map((i) => i.key)
          d.items.forEach((i) => seen.current.add(i.key))
          onChange(next)
        })
        .catch((e) => live && setErr(e.message))
    }, 350)
    return () => {
      live = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask])

  const previewKey = open && preview && params?.requestId ? JSON.stringify([params.requestId, preview]) : ''
  useEffect(() => {
    if (!previewKey) return
    let live = true
    setText(null)
    const [requestId, pv] = JSON.parse(previewKey)
    const t = setTimeout(() => {
      api<{ text: string }>('/messages/whatsapp', { body: { requestId, templateKey: pv.templateKey, to: 'patient', preview: true, date: pv.date || undefined, slot: pv.slot || undefined } })
        .then((r) => live && setText(r.text))
        .catch((e) => live && setText(`⚠ ${e.message}`))
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [previewKey])

  if (!params) return null
  const on = new Set(value ?? [])
  const toggle = (k: string) => onChange(on.has(k) ? [...on].filter((x) => x !== k) : [...on, k])
  const items = data?.items ?? []
  const sections: { title: string; rows: Item[] }[] = []
  for (const i of items) {
    const title = i.kind === 'group' ? i.group ?? 'Alert group' : KIND_TITLE[i.kind]
    const s = sections.find((x) => x.title === title) ?? (sections.push({ title, rows: [] }), sections[sections.length - 1])
    s.rows.push(i)
  }
  const selectable = items.filter((i) => !(i.kind === 'patient' && i.note))

  return (
    <div className={cx('rounded-lg bg-[#F0FDF4] px-3 py-2.5 ring-1 ring-[#BBF7D0]', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <MessageCircle size={18} className="mt-0.5 flex-none text-[#16A34A]" />
          <div className="min-w-0 text-[13px]">
            <b>Notify on WhatsApp</b>
            <div className="text-[12px] text-slate-600">
              {!data ? 'Finding who gets a message…' : !items.length ? 'Nobody gets a WhatsApp for this step.' : `Only the ticked people get a message · ${on.size} of ${items.length}`}
              {data && !data.paired && items.length > 0 && ' · WhatsApp is not paired, so nothing is sent automatically'}
            </div>
          </div>
        </div>
        {selectable.length > 1 && (
          <div className="flex flex-none gap-2 text-[12px] font-semibold text-[#15803D]">
            <button type="button" className="hover:underline" onClick={() => onChange(selectable.map((i) => i.key))}>
              All
            </button>
            <button type="button" className="hover:underline" onClick={() => onChange([])}>
              None
            </button>
          </div>
        )}
      </div>
      {!data && !err && <Loader2 size={14} className="ml-7 mt-1.5 animate-spin text-slate-400" />}
      {err && <div className="ml-7 mt-1.5 text-[12px] text-[#B91C1C]">{err}</div>}
      {sections.map((s) => (
        <div key={s.title} className="ml-7 mt-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{s.title}</div>
          {s.rows.map((i) => {
            const disabled = i.kind === 'patient' && !!i.note
            return (
              <label key={i.key} className={cx('flex min-h-[36px] items-center gap-2.5 py-1 text-[13px]', disabled ? 'opacity-60' : 'cursor-pointer')}>
                <input type="checkbox" className="size-4 flex-none accent-[#16A34A]" checked={on.has(i.key) && !disabled} disabled={disabled} onChange={() => toggle(i.key)} />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-slate-800">{i.name}</span>
                  <span className="text-slate-500">
                    {' '}
                    · {i.role}
                    {i.phone ? ` · ${fmtPhone(i.phone)}` : ''}
                  </span>
                  {i.note && <span className="text-[#B45309]"> · {i.note}</span>}
                </span>
                <span className="hidden flex-none text-[11px] text-slate-500 sm:inline">{i.what.join(' · ')}</span>
              </label>
            )
          })}
        </div>
      ))}
      {preview && params.requestId && on.has('patient') && (
        <div className="ml-7 mt-1">
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#15803D] hover:underline">
            <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} /> {open ? 'Hide patient message' : 'Preview patient message'}
          </button>
          {open && <div className="mt-1.5 whitespace-pre-wrap rounded-md bg-white px-3 py-2 text-[12.5px] leading-[18px] text-slate-700 ring-1 ring-slate-200">{text ?? <Loader2 size={14} className="animate-spin text-slate-400" />}</div>}
        </div>
      )}
    </div>
  )
}
