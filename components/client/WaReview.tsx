'use client'
// WhatsApp approval on the admin side. Nothing is sent on WhatsApp without an admin: messages wait as PENDING in the
// Outbox (lib/wa/outbox.ts).
//  · WaReviewProvider — mounted once for admins: the WhatsApp dock on the right (chat bubbles, Send / Edit / Discard).
//    Every change made through api() carries a batch id; when that click created WhatsApp messages the dock opens.
//  · OutboxCards — the message cards (also used by the Outbox page / pane).
//  · OutboxBadge — red count of waiting messages, for the sidebar and the top bar.
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Check, Clock3, FileText, Loader2, MessageCircle, Pencil, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { api, setMutationHook } from './api'
import { useToast } from './toast'
import { btnClass } from '@/components/ui'
import { cx, phone as fmtPhone } from '@/lib/format'

export type OutboxItem = {
  id: string
  to: string
  toName: string | null
  templateKey: string | null
  text: string
  edited: boolean
  file: string | null
  attachmentId: string | null
  requestId: string | null
  visit: string | null
  requestNo: string | null
  batch: string | null
  at: string
  urgent: boolean
}

/** tell every badge / list on the page that the Outbox changed */
export const outboxChanged = () => typeof window !== 'undefined' && window.dispatchEvent(new Event('hc:outbox'))

let reviewOn = false
/** true while the review window takes care of approvals (the old "Send this?" window then steps aside) */
export const reviewActive = () => reviewOn

const SKIP = /^\/(outbox|auth|notifications)\b/
const newBatch = () => `b${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

// ---------------------------------------------------------------- cards
export function OutboxCards({ items, onDone, showVisit = true, selectable = false, selected, onSelect, edits, setEdits }: {
  items: OutboxItem[]
  onDone: (ids: string[]) => void
  showVisit?: boolean
  selectable?: boolean
  selected?: Set<string>
  onSelect?: (id: string, on: boolean) => void
  edits: Record<string, string>
  setEdits: (fn: (e: Record<string, string>) => Record<string, string>) => void
}) {
  const toast = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  async function act(m: OutboxItem, action: 'send' | 'discard') {
    setBusy(m.id + action)
    try {
      const text = edits[m.id]
      await api('/outbox', { body: { action, ids: [m.id], ...(action === 'send' && text != null && text !== m.text ? { edits: { [m.id]: text } } : {}) } })
      toast(action === 'send' ? `Sending to ${m.toName ?? fmtPhone(m.to)}` : 'Discarded — not sent', 'ok')
      onDone([m.id])
      outboxChanged()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((m) => {
        const text = edits[m.id] ?? m.text
        const changed = text !== m.text
        return (
          <div key={m.id} className={cx('rounded-xl border bg-white p-3', selected?.has(m.id) ? 'border-primary ring-1 ring-primary/30' : 'border-slate-200')}>
            <div className="flex items-start gap-2.5">
              {selectable && <input type="checkbox" className="mt-1 size-4 flex-none accent-[#0090CA]" checked={!!selected?.has(m.id)} onChange={(e) => onSelect?.(m.id, e.target.checked)} aria-label="Select" />}
              <span className="flex size-8 flex-none items-center justify-center rounded-full bg-[#DCFCE7] text-[#15803D]">
                <MessageCircle size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <b className="text-[14px]">{m.toName ?? 'WhatsApp'}</b>
                  <span className="text-[12.5px] text-slate-500">{fmtPhone(m.to)}</span>
                  {m.urgent && <span className="rounded bg-[#FEE2E2] px-1.5 text-[10.5px] font-bold uppercase text-[#B91C1C]">urgent</span>}
                  {(m.edited || changed) && <span className="rounded bg-[#FEF3C7] px-1.5 text-[10.5px] font-bold uppercase text-[#B45309]">edited</span>}
                  <span className="ml-auto text-[11.5px] text-slate-400">{ago(m.at)}</span>
                </div>
                {showVisit && m.visit && (
                  <div className="truncate text-[12px] text-slate-500">
                    {m.requestId ? (
                      <Link href={`/requests/${m.requestId}`} className="hover:text-primary-700 hover:underline">
                        {m.visit}
                      </Link>
                    ) : (
                      m.visit
                    )}
                  </div>
                )}
              </div>
            </div>
            {editing === m.id ? (
              <div className="mt-2">
                <textarea className="hc-input min-h-[140px] text-[13px] leading-[19px]" value={text} onChange={(e) => setEdits((x) => ({ ...x, [m.id]: e.target.value }))} autoFocus maxLength={1500} />
                <div className="mt-1 flex items-center gap-3 text-[12px]">
                  <button type="button" className="inline-flex items-center gap-1 font-semibold text-primary-700" onClick={() => setEditing(null)}>
                    <Check size={13} /> Done
                  </button>
                  {changed && (
                    <button type="button" className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700" onClick={() => setEdits((x) => ({ ...x, [m.id]: m.text }))}>
                      <RotateCcw size={12} /> Undo my changes
                    </button>
                  )}
                  <span className="ml-auto text-slate-400">{text.length}/1500</span>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setEditing(m.id)} className="group mt-2 block w-full text-left" title="Click to edit">
                <div className="max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#F0FDF4] px-3 py-2.5 text-[13px] leading-[19px] text-slate-800 ring-1 ring-[#BBF7D0] group-hover:ring-primary/40">{text}</div>
              </button>
            )}
            {m.file && (
              <div className="mt-2 flex items-center gap-1.5 text-[12.5px] text-slate-600">
                <FileText size={14} className="text-slate-400" />
                {m.attachmentId ? (
                  <a href={`/api/v1/attachments/${m.attachmentId}`} target="_blank" rel="noreferrer" className="font-semibold text-primary-700 hover:underline">
                    {m.file}
                  </a>
                ) : (
                  m.file
                )}
              </div>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <button type="button" className={btnClass('g', 'sm')} disabled={!!busy || !text.trim()} onClick={() => act(m, 'send')}>
                {busy === m.id + 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
              </button>
              {editing !== m.id && (
                <button type="button" className={btnClass('o', 'sm')} onClick={() => setEditing(m.id)}>
                  <Pencil size={14} /> Edit
                </button>
              )}
              <button type="button" className={btnClass('o', 'sm', 'ml-auto text-[#B91C1C]')} disabled={!!busy} onClick={() => act(m, 'discard')}>
                {busy === m.id + 'discard' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Discard
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Send / discard many at once, with the edits made in the cards. */
export async function bulk(action: 'send' | 'discard', items: OutboxItem[], edits: Record<string, string>) {
  const changed = Object.fromEntries(items.filter((m) => edits[m.id] != null && edits[m.id] !== m.text).map((m) => [m.id, edits[m.id]]))
  const r = await api<{ count: number }>('/outbox', { body: { action, ids: items.map((m) => m.id), ...(action === 'send' && Object.keys(changed).length ? { edits: changed } : {}) } })
  outboxChanged()
  return r.count
}

// ---------------------------------------------------------------- the WhatsApp dock (right sidebar, like a chat)
const DOCK_EVENT = 'hc:wa-dock'
const DOCK_KEY = 'hc:wa-dock-open'
/** open / close / toggle the WhatsApp dock from anywhere (top-bar button, links) */
export const waDock = (to: 'open' | 'close' | 'toggle' = 'toggle') => typeof window !== 'undefined' && window.dispatchEvent(new CustomEvent(DOCK_EVENT, { detail: to }))
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit', hour12: true })

/** Top-bar button: opens the dock (with the waiting count). */
export function WaDockButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => waDock('toggle')} className={cx('relative flex size-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50', className)} aria-label="WhatsApp waiting for approval" title="WhatsApp waiting for approval">
      <Send size={17} />
      <OutboxBadge className="absolute -right-1.5 -top-1.5" />
    </button>
  )
}

/** One message as an outgoing chat bubble: who it goes to, the text (tap to edit), Send / Edit / Discard. */
function Bubble({ m, fresh, text, onText, onDone }: { m: OutboxItem; fresh: boolean; text: string; onText: (t: string | null) => void; onDone: (id: string) => void }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<null | 'send' | 'discard'>(null)
  const changed = text !== m.text
  async function act(action: 'send' | 'discard') {
    setBusy(action)
    try {
      await api('/outbox', { body: { action, ids: [m.id], ...(action === 'send' && changed ? { edits: { [m.id]: text } } : {}) } })
      toast(action === 'send' ? `Sending to ${m.toName ?? fmtPhone(m.to)}` : 'Discarded — not sent', 'ok')
      onDone(m.id)
      outboxChanged()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-col items-end">
      <div className={cx('relative w-full max-w-[94%] rounded-xl rounded-tr-sm bg-[#D9FDD3] px-3 pb-1.5 pt-2 shadow-[0_1px_0.5px_rgba(11,20,26,.13)]', fresh && 'ring-2 ring-[#25D366] ring-offset-1 ring-offset-[#EFEAE2]')}>
        <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px]">
          <b className="text-[#027EB5]">To {m.toName ?? 'WhatsApp'}</b>
          <span className="text-slate-500">{fmtPhone(m.to)}</span>
          {fresh && <span className="rounded bg-[#25D366] px-1 text-[10px] font-bold uppercase text-white">new</span>}
          {m.urgent && <span className="rounded bg-[#FEE2E2] px-1 text-[10px] font-bold uppercase text-[#B91C1C]">urgent</span>}
          {(m.edited || changed) && <span className="rounded bg-[#FEF3C7] px-1 text-[10px] font-bold uppercase text-[#B45309]">edited</span>}
        </div>
        {editing ? (
          <>
            <textarea className="w-full rounded-lg border border-[#86EFAC] bg-white p-2 text-[13px] leading-[19px] outline-none focus:border-[#25D366]" rows={Math.min(14, Math.max(5, text.split('\n').length + 1))} value={text} onChange={(e) => onText(e.target.value)} autoFocus maxLength={1500} />
            <div className="mt-1 flex items-center gap-3 text-[12px]">
              <button type="button" className="inline-flex items-center gap-1 font-semibold text-[#008069]" onClick={() => setEditing(false)}>
                <Check size={13} /> Done
              </button>
              {changed && (
                <button type="button" className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-700" onClick={() => onText(null)}>
                  <RotateCcw size={12} /> Undo
                </button>
              )}
              <span className="ml-auto text-slate-400">{text.length}/1500</span>
            </div>
          </>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="block w-full whitespace-pre-wrap text-left text-[13.5px] leading-[19px] text-[#111B21]" title="Tap to edit">
            {text}
          </button>
        )}
        {m.file && (
          <div className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-white/70 px-2 py-1.5 text-[12.5px]">
            <FileText size={14} className="text-[#B91C1C]" />
            {m.attachmentId ? (
              <a href={`/api/v1/attachments/${m.attachmentId}`} target="_blank" rel="noreferrer" className="truncate font-semibold text-[#027EB5] hover:underline">
                {m.file}
              </a>
            ) : (
              <span className="truncate">{m.file}</span>
            )}
          </div>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-slate-500" title="Waiting for your approval — not sent yet">
          {clock(m.at)} <Clock3 size={11} />
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <button type="button" disabled={!!busy || !text.trim()} onClick={() => act('send')} className="inline-flex h-8 items-center gap-1 rounded-full bg-[#25D366] px-3 text-[12.5px] font-bold text-white shadow-sm hover:bg-[#1DA851] disabled:opacity-50">
          {busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
        </button>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex h-8 items-center gap-1 rounded-full bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
            <Pencil size={13} /> Edit
          </button>
        )}
        <button type="button" disabled={!!busy} onClick={() => act('discard')} className="inline-flex h-8 items-center gap-1 rounded-full bg-white px-3 text-[12.5px] font-semibold text-[#B91C1C] shadow-sm hover:bg-red-50 disabled:opacity-50">
          {busy === 'discard' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Discard
        </button>
      </div>
    </div>
  )
}

/**
 * Mounted once for admins (app/(admin)/layout.tsx). A WhatsApp-style dock on the right: every message waiting for
 * approval as a chat bubble, grouped by visit, with Send / Edit / Discard and "Send all". On wide screens it sits beside
 * the page as a sidebar; on phones it covers the screen. Every change made through api() carries a batch id — when a
 * click created WhatsApp messages the dock opens by itself and marks them "new".
 */
export function WaReviewProvider({ overlay = false }: { overlay?: boolean } = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<OutboxItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [scope, setScope] = useState<'all' | 'visit'>('all')
  const [busy, setBusy] = useState<'send' | 'discard' | null>(null)
  const [sure, setSure] = useState(false)
  const seen = useRef(new Set<string>())
  const body = useRef<HTMLDivElement>(null)
  const visitId = pathname.match(/^\/(?:requests|m\/visits)\/([a-f0-9]{24})/i)?.[1] ?? null

  const load = useCallback(async () => {
    const r = await api<{ items: OutboxItem[] }>('/outbox').catch(() => null)
    if (!r) return
    setItems(r.items)
    setLoaded(true)
    r.items.forEach((m) => seen.current.add(m.id))
  }, [])

  const collect = useCallback(
    async (batch: string) => {
      // the action's background work queues its messages a moment after the response: look a few times until it settles
      let last = -1
      for (const wait of [600, 1200, 1800, 2500, 3500]) {
        await new Promise((r) => setTimeout(r, wait))
        const r = await api<{ items: OutboxItem[] }>(`/outbox?batch=${batch}`).catch(() => null)
        if (!r) return
        const n = r.items.filter((m) => !seen.current.has(m.id)).length
        if (n && n === last) break
        last = n
      }
      const r = await api<{ items: OutboxItem[] }>(`/outbox?batch=${batch}`).catch(() => null)
      const got = (r?.items ?? []).filter((m) => !seen.current.has(m.id))
      if (!got.length) return
      got.forEach((m) => seen.current.add(m.id))
      setFresh((f) => new Set([...f, ...got.map((m) => m.id)]))
      await load()
      setOpen(true)
      setTimeout(() => body.current?.scrollTo({ top: 0, behavior: 'smooth' }), 50)
      outboxChanged()
    },
    [load],
  )

  useEffect(() => {
    reviewOn = true
    setMutationHook({
      start: (path) => (SKIP.test(path) ? null : newBatch()),
      done: (batch) => void collect(batch),
    })
    return () => {
      reviewOn = false
      setMutationHook(null)
    }
  }, [collect])

  // remember open / closed on this device; open / close from the top-bar button
  useEffect(() => {
    try {
      if (localStorage.getItem(DOCK_KEY) === '1') setOpen(true)
    } catch {}
    const on = (e: Event) => {
      const to = (e as CustomEvent).detail as 'open' | 'close' | 'toggle'
      setOpen((o) => (to === 'toggle' ? !o : to === 'open'))
    }
    window.addEventListener(DOCK_EVENT, on)
    return () => window.removeEventListener(DOCK_EVENT, on)
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(DOCK_KEY, open ? '1' : '0')
    } catch {}
    if (!open) {
      setSure(false)
      return
    }
    void load()
    const t = setInterval(load, 30_000)
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('hc:outbox', load)
    window.addEventListener('keydown', k)
    return () => {
      clearInterval(t)
      window.removeEventListener('hc:outbox', load)
      window.removeEventListener('keydown', k)
    }
  }, [open, load])
  // on a request page, start with that visit's messages
  useEffect(() => setScope(visitId ? 'visit' : 'all'), [visitId])

  const visitItems = visitId ? items.filter((m) => m.requestId === visitId) : []
  const shown = scope === 'visit' && visitId ? visitItems : items
  // grouped by visit (newest group first), each group in chat order (oldest first)
  const groups: { key: string; m: OutboxItem[] }[] = []
  for (const m of shown) {
    const key = m.requestId ?? 'other'
    const g = groups.find((x) => x.key === key)
    if (g) g.m.push(m)
    else groups.push({ key, m: [m] })
  }
  groups.forEach((g) => g.m.reverse())

  const done = (ids: string[]) => {
    setItems((cur) => cur.filter((m) => !ids.includes(m.id)))
    setFresh((f) => new Set([...f].filter((x) => !ids.includes(x))))
    router.refresh()
  }
  async function all(action: 'send' | 'discard') {
    if (!shown.length) return
    if (action === 'discard' && !sure) return setSure(true)
    setBusy(action)
    try {
      const n = await bulk(action, shown, edits)
      toast(action === 'send' ? `Sending ${n} WhatsApp message${n === 1 ? '' : 's'}` : `${n} discarded — not sent`, 'ok')
      done(shown.map((m) => m.id))
      setSure(false)
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {/* the toggle: a green tab on the right edge while messages wait */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-24 right-0 z-[70] flex items-center gap-1.5 rounded-l-2xl bg-[#25D366] py-2.5 pl-3 pr-2.5 text-white shadow-[0_6px_20px_rgba(37,211,102,.45)] transition hover:pr-4 sm:bottom-28"
          aria-label="Open WhatsApp messages waiting for approval"
          title="WhatsApp waiting for approval"
        >
          <MessageCircle size={20} />
          <span className="hidden text-[13px] font-bold sm:inline">WhatsApp</span>
          <OutboxBadge className="ring-2 ring-white" />
        </button>
      )}
      {open && (
        <aside className={cx('fixed inset-0 z-[75] flex flex-col bg-[#EFEAE2] shadow-drawer sm:left-auto sm:w-[420px]', !overlay && 'lg:static lg:z-auto lg:h-dvh lg:w-[400px] lg:flex-none lg:border-l lg:border-slate-200 lg:shadow-none')} aria-label="WhatsApp waiting for approval">
          {/* header */}
          <div className="flex items-center gap-2.5 bg-[#008069] px-3.5 py-3 text-white">
            <span className="flex size-10 flex-none items-center justify-center rounded-full bg-white/15">
              <MessageCircle size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15.5px] font-bold leading-tight">WhatsApp</div>
              <div className="truncate text-[12px] text-white/80">{!loaded ? 'Loading…' : items.length ? `${items.length} waiting for your approval · nothing sent yet` : 'Nothing waiting — all clear'}</div>
            </div>
            <Link href="/outbox" className="rounded-lg px-2 py-1.5 text-[12px] font-semibold text-white/90 hover:bg-white/10" title="Full Outbox page">
              Outbox
            </Link>
            <button type="button" onClick={() => setOpen(false)} className="flex size-9 items-center justify-center rounded-full hover:bg-white/10" aria-label="Close">
              <X size={19} />
            </button>
          </div>
          {visitId && (
            <div className="flex gap-1.5 bg-[#F0F2F5] px-3 py-2">
              {(
                [
                  ['visit', `This visit · ${visitItems.length}`],
                  ['all', `All · ${items.length}`],
                ] as const
              ).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setScope(k)} className={cx('h-8 rounded-full px-3 text-[12.5px] font-semibold', scope === k ? 'bg-[#D9FDD3] text-[#008069] ring-1 ring-[#25D366]/50' : 'bg-white text-slate-600')}>
                  {l}
                </button>
              ))}
            </div>
          )}
          {/* chat */}
          <div ref={body} className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(#d8d2c6_1px,transparent_1px)] px-3 py-3 [background-size:18px_18px]">
            {!loaded ? (
              <div className="flex justify-center py-10">
                <Loader2 size={22} className="animate-spin text-slate-400" />
              </div>
            ) : !shown.length ? (
              <div className="mx-auto mt-10 max-w-[260px] rounded-xl bg-white/90 px-4 py-5 text-center text-[13px] text-slate-600 shadow-sm">
                <Check size={26} className="mx-auto mb-1.5 text-[#25D366]" />
                {scope === 'visit' && items.length ? 'Nothing waiting for this visit.' : 'No WhatsApp waiting for approval.'}
                {scope === 'visit' && items.length > 0 && (
                  <button type="button" onClick={() => setScope('all')} className="mt-2 block w-full font-semibold text-[#008069]">
                    Show all {items.length}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {groups.map((g) => {
                  const v = g.m[0]
                  return (
                    <div key={g.key} className="flex flex-col gap-2.5">
                      <div className="mx-auto max-w-[92%] truncate rounded-lg bg-white/95 px-2.5 py-1 text-center text-[11.5px] font-semibold text-slate-600 shadow-sm">
                        {v.requestId && v.visit ? (
                          <Link href={`/requests/${v.requestId}`} className="hover:text-[#008069] hover:underline">
                            {v.visit}
                          </Link>
                        ) : (
                          v.visit ?? 'Other messages'
                        )}
                      </div>
                      {g.m.map((m) => (
                        <Bubble key={m.id} m={m} fresh={fresh.has(m.id)} text={edits[m.id] ?? m.text} onText={(t) => setEdits((x) => (t == null ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== m.id)) : { ...x, [m.id]: t }))} onDone={(id) => done([id])} />
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {/* send all */}
          {shown.length > 0 && (
            <div className="flex items-center gap-2 bg-[#F0F2F5] px-3 py-2.5">
              <button type="button" disabled={!!busy} onClick={() => all('discard')} onBlur={() => setSure(false)} className={cx('inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold shadow-sm disabled:opacity-50', sure ? 'bg-[#DC2626] text-white' : 'bg-white text-[#B91C1C]')}>
                {busy === 'discard' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} {sure ? `Discard ${shown.length}?` : 'Don’t send'}
              </button>
              <button type="button" disabled={!!busy} onClick={() => all('send')} className="ml-auto inline-flex h-11 items-center gap-2 rounded-full bg-[#25D366] px-5 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(37,211,102,.4)] hover:bg-[#1DA851] disabled:opacity-50">
                {busy === 'send' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send {shown.length === 1 ? '' : `all ${shown.length}`}
              </button>
            </div>
          )}
        </aside>
      )}
    </>
  )
}

// ---------------------------------------------------------------- badge
export function OutboxBadge({ initial = 0, className }: { initial?: number; className?: string }) {
  const [n, setN] = useState(initial)
  useEffect(() => {
    let live = true
    const load = () =>
      api<{ count: number }>('/outbox?count=1')
        .then((r) => live && setN(r.count))
        .catch(() => {})
    const t = setInterval(load, 30_000)
    window.addEventListener('hc:outbox', load)
    load()
    return () => {
      live = false
      clearInterval(t)
      window.removeEventListener('hc:outbox', load)
    }
  }, [])
  if (n <= 0) return null
  return <span className={cx('flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#DC2626] px-1.5 text-[11px] font-bold text-white', className)}>{n > 99 ? '99+' : n}</span>
}
