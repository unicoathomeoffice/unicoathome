'use client'
// WhatsApp approval on the admin side. Nothing is sent on WhatsApp without an admin: messages wait as PENDING in the
// Outbox (lib/wa/outbox.ts).
//  · WaReviewProvider — mounted once for admins. Every change made through api() carries a batch id; when that click
//    created WhatsApp messages, the "Review & send" window opens with exactly those messages (preview, edit, send).
//  · OutboxCards — the message cards (also used by the Outbox page / pane).
//  · OutboxBadge — red count of waiting messages, for the sidebar and the top bar.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, FileText, Loader2, MessageCircle, Pencil, RotateCcw, Send, Trash2, X } from 'lucide-react'
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

// ---------------------------------------------------------------- review window after a click
export function WaReviewProvider() {
  const router = useRouter()
  const toast = useToast()
  const [items, setItems] = useState<OutboxItem[] | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'send' | 'discard' | null>(null)
  const seen = useRef(new Set<string>())

  const collect = useCallback(async (batch: string) => {
    // the action's background work queues its messages a moment after the response: look a few times until it settles
    let last = -1
    for (const wait of [600, 1200, 1800, 2500, 3500]) {
      await new Promise((r) => setTimeout(r, wait))
      const r = await api<{ items: OutboxItem[] }>(`/outbox?batch=${batch}`).catch(() => null)
      if (!r) return
      const fresh = r.items.filter((m) => !seen.current.has(m.id))
      if (fresh.length && fresh.length === last) break
      last = fresh.length
    }
    const r = await api<{ items: OutboxItem[] }>(`/outbox?batch=${batch}`).catch(() => null)
    const fresh = (r?.items ?? []).filter((m) => !seen.current.has(m.id)).reverse()
    if (!fresh.length) return
    fresh.forEach((m) => seen.current.add(m.id))
    setItems((cur) => [...(cur ?? []), ...fresh])
    outboxChanged()
  }, [])

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

  const close = () => {
    setItems(null)
    setEdits({})
  }
  const remaining = (ids: string[]) =>
    setItems((cur) => {
      const left = (cur ?? []).filter((m) => !ids.includes(m.id))
      return left.length ? left : null
    })

  async function all(action: 'send' | 'discard') {
    if (!items?.length) return
    setBusy(action)
    try {
      const n = await bulk(action, items, edits)
      toast(action === 'send' ? `Sending ${n} WhatsApp message${n === 1 ? '' : 's'}` : `${n} discarded — not sent`, 'ok')
      close()
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  if (!items?.length) return null
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Review WhatsApp messages">
      <div className="relative flex max-h-[90dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-page shadow-drawer">
        <div className="flex items-center gap-2.5 border-b border-slate-200 bg-white px-5 py-4">
          <span className="flex size-9 flex-none items-center justify-center rounded-full bg-[#DCFCE7] text-[#15803D]">
            <MessageCircle size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold leading-snug">
              Review &amp; send {items.length} WhatsApp message{items.length === 1 ? '' : 's'}
            </div>
            <div className="text-[12.5px] text-slate-500">Nothing has been sent yet. Check each message, tap it to edit, then send.</div>
          </div>
          <button type="button" onClick={close} className="flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Decide later">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4">
          <OutboxCards items={items} onDone={remaining} edits={edits} setEdits={setEdits} />
        </div>
        <div className="flex flex-wrap items-center gap-2.5 border-t border-slate-200 bg-white px-5 py-3.5">
          <button type="button" className={btnClass('o', 'md', 'text-[#B91C1C]')} disabled={!!busy} onClick={() => all('discard')}>
            {busy === 'discard' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Don’t send
          </button>
          <button type="button" className={btnClass('o', 'md')} disabled={!!busy} onClick={close} title="They stay in the Outbox">
            Later
          </button>
          <button type="button" autoFocus className={btnClass('g', 'md', 'ml-auto')} disabled={!!busy} onClick={() => all('send')}>
            {busy === 'send' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send {items.length === 1 ? '' : `all ${items.length}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
