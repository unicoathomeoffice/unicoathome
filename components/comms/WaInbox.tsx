'use client'
// The WhatsApp inbox (/outbox, phone /m/admin/outbox) — looks and works like WhatsApp: chats on the left (one per
// number, those with messages waiting for approval on top), the conversation on the right with the whole history of
// every message: waiting, sent ✓, delivered ✓✓, read (blue ✓✓), failed (Retry) or not sent. Waiting messages are
// edited / sent / discarded right in the chat, and an admin can type a new message. Data: lib/wa/history.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, Ban, Check, CheckCheck, ChevronDown, Clock3, ExternalLink, FileText, Info, Loader2, MessageCircle, Pencil, RefreshCw, RotateCcw, Search, Send, ShieldCheck, Trash2, UserRound, X } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { outboxChanged } from '@/components/client/WaReview'
import { cx, phone as fmtPhone } from '@/lib/format'

export type ChatRow = { to: string; name: string; role: string | null; last: { text: string; status: string; at: string; file: string | null }; waiting: number; failed: number; total: number }
type Contact = { to: string; name: string; role: string | null; href: string | null }
type Msg = {
  id: string
  text: string
  originalText: string | null
  status: string
  at: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  untracked: boolean
  error: string | null
  file: string | null
  attachmentId: string | null
  templateKey: string | null
  urgent: boolean
  initiatedBy: string | null
  approvedBy: string | null
  editedBy: string | null
  events: { status: string; at: string; note: string | null }[]
  visit: { id: string; label: string; requestNo: string; status: string } | null
}
type Thread = { contact: Contact; items: Msg[]; hasMore: boolean }
type Filter = 'all' | 'waiting' | 'sent' | 'failed' | 'discarded'

const TZ = 'Asia/Dhaka'
const dayKey = (iso: string | number) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
function dayLabel(iso: string) {
  const k = dayKey(iso)
  if (k === dayKey(Date.now())) return 'Today'
  if (k === dayKey(Date.now() - 86400_000)) return 'Yesterday'
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
}
function listTime(iso: string) {
  const k = dayKey(iso)
  if (k === dayKey(Date.now())) return clock(iso)
  if (k === dayKey(Date.now() - 86400_000)) return 'Yesterday'
  if (Date.now() - new Date(iso).getTime() < 6 * 86400_000) return new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long' })
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit' })
}
const agoShort = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
const fullTime = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
const initials = (name: string) => (name.startsWith('+') ? '' : name.replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join(''))
const AVATAR = ['#00A884', '#027EB5', '#7E57C2', '#E67E22', '#D81B60', '#00897B', '#5C6BC0', '#6D4C41']
const avatarBg = (s: string) => AVATAR[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length]

const STATUS: Record<string, string> = {
  PENDING: 'Waiting for approval',
  PREPARED: 'Prepared',
  QUEUED: 'Approved · sending',
  SENT: 'Sent',
  SENT_CONFIRMED: 'Sent',
  DELIVERED: 'Delivered',
  OPENED: 'Read',
  FAILED: 'Failed',
  SKIPPED: 'Not sent',
}

/** "Sent 10:31 am · Delivered 10:31 am · Read 10:40 am" for the tick tooltip */
function tickTitle(m: { status: string; sentAt?: string | null; deliveredAt?: string | null; readAt?: string | null; untracked?: boolean }) {
  const parts = [m.sentAt && `Sent ${clock(m.sentAt)}`, m.deliveredAt && `Delivered ${clock(m.deliveredAt)}`, m.readAt && `Read ${clock(m.readAt)}`].filter(Boolean)
  if (m.untracked) parts.push('no delivery report (sent before tracking started)')
  else if (m.status === 'SENT' || m.status === 'SENT_CONFIRMED') parts.push('waiting for the delivery report')
  return parts.join(' · ') || (STATUS[m.status] ?? m.status)
}

function Ticks({ status, size = 15 }: { status: string; size?: number }) {
  if (status === 'PENDING') return <Clock3 size={size - 2} className="text-[#D97706]" aria-label="Waiting for approval" />
  if (status === 'QUEUED' || status === 'PREPARED') return <Clock3 size={size - 2} className="text-slate-400" aria-label="Sending" />
  if (status === 'SENT' || status === 'SENT_CONFIRMED') return <Check size={size} className="text-slate-500" aria-label="Sent" />
  if (status === 'DELIVERED') return <CheckCheck size={size} className="text-slate-500" aria-label="Delivered" />
  if (status === 'OPENED') return <CheckCheck size={size} className="text-[#53BDEB]" aria-label="Read" />
  if (status === 'FAILED') return <AlertCircle size={size - 1} className="text-[#DC2626]" aria-label="Failed" />
  return <Ban size={size - 2} className="text-slate-400" aria-label="Not sent" />
}

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const ini = initials(name)
  return (
    <span className="flex flex-none items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: ini ? avatarBg(name) : '#DFE5E7', fontSize: size * 0.36 }}>
      {ini || <UserRound size={size * 0.55} className="text-white" />}
    </span>
  )
}

// ================================================================ one message
function Bubble({ m, requestHref, edit, onEdit, onAct, busy }: { m: Msg; requestHref: (id: string) => string; edit: string | undefined; onEdit: (t: string | null) => void; onAct: (a: 'send' | 'discard' | 'retry') => void; busy: string | null }) {
  const [info, setInfo] = useState(false)
  const [editing, setEditing] = useState(false)
  const waiting = m.status === 'PENDING'
  const failed = m.status === 'FAILED'
  const skipped = m.status === 'SKIPPED'
  const text = edit ?? m.text
  const changed = edit != null && edit !== m.text
  const stale = m.visit && ['CANCELLED', 'CLOSED'].includes(m.visit.status)
  return (
    <div className="flex flex-col items-end">
      <div
        className={cx(
          'group relative w-fit min-w-[200px] max-w-[min(600px,88%)] rounded-lg rounded-tr-none px-2.5 pb-1.5 pt-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,.13)]',
          skipped ? 'bg-[#F5F6F6] text-slate-500' : 'bg-[#D9FDD3] text-[#111B21]',
          waiting && 'ring-1 ring-[#F59E0B]/60',
          failed && 'ring-1 ring-[#DC2626]/50',
        )}
      >
        {/* tail */}
        <span className={cx('absolute -right-[7px] top-0 h-3 w-2', skipped ? 'bg-[#F5F6F6]' : 'bg-[#D9FDD3]')} style={{ clipPath: 'polygon(0 0,100% 0,0 100%)' }} />
        {(waiting || failed || skipped) && (
          <div className={cx('mb-1 flex items-center gap-1 text-[11.5px] font-semibold', waiting ? 'text-[#B45309]' : failed ? 'text-[#B91C1C]' : 'text-slate-500')}>
            {waiting ? <Clock3 size={12} /> : failed ? <AlertCircle size={12} /> : <Ban size={12} />}
            {waiting ? 'Waiting for your approval — not sent yet' : failed ? `Failed${m.error ? ` · ${m.error}` : ''}` : `Not sent${m.error ? ` · ${m.error}` : ''}`}
          </div>
        )}
        {m.visit && (
          <Link href={requestHref(m.visit.id)} className={cx('mb-1 flex max-w-full items-center gap-1.5 rounded-md border-l-[3px] bg-black/[.04] px-2 py-1 text-[11.5px] hover:bg-black/[.07]', stale ? 'border-[#DC2626]' : 'border-[#06CF9C]')}>
            <span className="min-w-0 flex-1 truncate font-medium text-slate-600">{m.visit.label}</span>
            {stale && <span className="flex-none rounded bg-[#FEE2E2] px-1 text-[10px] font-bold uppercase text-[#B91C1C]">{m.visit.status === 'CANCELLED' ? 'Visit cancelled' : 'Closed'}</span>}
          </Link>
        )}
        {editing ? (
          <div>
            <textarea className="w-full min-w-[260px] rounded-md border border-[#86EFAC] bg-white p-2 text-[13.5px] leading-[19px] outline-none focus:border-[#25D366]" rows={Math.min(16, Math.max(4, text.split('\n').length + 1))} value={text} onChange={(e) => onEdit(e.target.value)} autoFocus maxLength={1500} />
            <div className="mt-1 flex items-center gap-3 text-[12px]">
              <button type="button" className="inline-flex items-center gap-1 font-semibold text-[#008069]" onClick={() => setEditing(false)}>
                <Check size={13} /> Done
              </button>
              {changed && (
                <button type="button" className="inline-flex items-center gap-1 text-slate-500" onClick={() => onEdit(null)}>
                  <RotateCcw size={12} /> Undo
                </button>
              )}
              <span className="ml-auto text-slate-400">{text.length}/1500</span>
            </div>
          </div>
        ) : (
          <div className={cx('whitespace-pre-wrap break-words text-[14px] leading-[19px]', skipped && 'line-through decoration-slate-300', waiting && 'cursor-text')} onClick={() => waiting && setEditing(true)} title={waiting ? 'Click to edit before sending' : undefined}>
            {text}
          </div>
        )}
        {m.file && (
          <div className="mt-1.5 flex items-center gap-2 rounded-md bg-black/[.05] px-2 py-2 text-[12.5px]">
            <span className="flex size-8 items-center justify-center rounded bg-[#DC2626] text-white">
              <FileText size={16} />
            </span>
            {m.attachmentId ? (
              <a href={`/api/v1/attachments/${m.attachmentId}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold text-[#027EB5] hover:underline">
                {m.file}
              </a>
            ) : (
              <span className="min-w-0 flex-1 truncate">{m.file}</span>
            )}
          </div>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-[#667781]">
          {(m.originalText || changed) && <span className="mr-0.5 italic">Edited</span>}
          {m.urgent && <span className="mr-0.5 font-semibold text-[#B91C1C]">Urgent</span>}
          <button type="button" onClick={() => setInfo(!info)} className="mr-0.5 rounded p-0.5 text-slate-400 opacity-60 hover:bg-black/5 hover:text-slate-600 group-hover:opacity-100" title="Message info" aria-label="Message info">
            <Info size={12} />
          </button>
          {clock(m.sentAt ?? m.at)}
          <span title={tickTitle(m)} className="inline-flex">
            <Ticks status={m.status} />
          </span>
        </div>
      </div>

      {/* actions for a waiting / failed message */}
      {(waiting || failed) && (
        <div className="mt-1 flex items-center gap-1">
          {waiting && (
            <>
              <button type="button" disabled={!!busy || !text.trim()} onClick={() => onAct('send')} className="inline-flex h-8 items-center gap-1 rounded-full bg-[#25D366] px-3 text-[12.5px] font-bold text-white shadow-sm hover:bg-[#1DA851] disabled:opacity-50">
                {busy === m.id + 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
              </button>
              {!editing && (
                <button type="button" onClick={() => setEditing(true)} className="inline-flex h-8 items-center gap-1 rounded-full bg-white px-3 text-[12.5px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
                  <Pencil size={13} /> Edit
                </button>
              )}
              <button type="button" disabled={!!busy} onClick={() => onAct('discard')} className="inline-flex h-8 items-center gap-1 rounded-full bg-white px-3 text-[12.5px] font-semibold text-[#B91C1C] shadow-sm hover:bg-red-50 disabled:opacity-50">
                {busy === m.id + 'discard' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Discard
              </button>
            </>
          )}
          {failed && (
            <button type="button" disabled={!!busy} onClick={() => onAct('retry')} className="inline-flex h-8 items-center gap-1 rounded-full bg-white px-3 text-[12.5px] font-semibold text-[#008069] shadow-sm hover:bg-emerald-50 disabled:opacity-50">
              {busy === m.id + 'retry' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Retry
            </button>
          )}
        </div>
      )}

      {/* message info: the whole story of this message */}
      {info && (
        <div className="mt-1.5 w-full max-w-[min(600px,88%)] rounded-lg bg-white p-3 text-[12.5px] shadow-sm ring-1 ring-slate-200">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-[13px]">Message info</b>
            <button type="button" onClick={() => setInfo(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <dl className="mb-2 grid grid-cols-[110px_1fr] gap-x-2 gap-y-1">
            <dt className="text-slate-500">Status</dt>
            <dd className="flex items-center gap-1 font-semibold">
              <Ticks status={m.status} size={14} /> {STATUS[m.status] ?? m.status}
            </dd>
            {m.sentAt && (
              <>
                <dt className="text-slate-500">Sent</dt>
                <dd>{fullTime(m.sentAt)}</dd>
                <dt className="text-slate-500">Delivered</dt>
                <dd className="flex items-center gap-1">
                  {m.deliveredAt ? (
                    <>
                      <CheckCheck size={14} className="text-slate-500" /> {fullTime(m.deliveredAt)}
                    </>
                  ) : (
                    <span className="text-slate-400">{m.untracked ? 'No report (sent before delivery tracking started)' : 'Not reported yet'}</span>
                  )}
                </dd>
                <dt className="text-slate-500">Read</dt>
                <dd className="flex items-center gap-1">
                  {m.readAt ? (
                    <>
                      <CheckCheck size={14} className="text-[#53BDEB]" /> {fullTime(m.readAt)}
                    </>
                  ) : (
                    <span className="text-slate-400">{m.untracked ? '—' : 'Not yet, or read receipts are off on their phone'}</span>
                  )}
                </dd>
              </>
            )}
            {m.templateKey && (
              <>
                <dt className="text-slate-500">Message</dt>
                <dd>{m.templateKey === 'custom' ? 'Typed by hand' : m.templateKey.replace(/_/g, ' ')}</dd>
              </>
            )}
            {m.initiatedBy && (
              <>
                <dt className="text-slate-500">Started by</dt>
                <dd>{m.initiatedBy}</dd>
              </>
            )}
            {m.editedBy && (
              <>
                <dt className="text-slate-500">Edited by</dt>
                <dd>{m.editedBy}</dd>
              </>
            )}
            {m.approvedBy && (
              <>
                <dt className="text-slate-500">Approved by</dt>
                <dd>{m.approvedBy}</dd>
              </>
            )}
            {m.visit && (
              <>
                <dt className="text-slate-500">Visit</dt>
                <dd>
                  <Link href={requestHref(m.visit.id)} className="font-semibold text-[#027EB5] hover:underline">
                    {m.visit.requestNo}
                  </Link>{' '}
                  · {m.visit.status.replace(/_/g, ' ').toLowerCase()}
                </dd>
              </>
            )}
          </dl>
          <ol className="relative ml-1.5 border-l border-slate-200 pl-3.5">
            {m.events.map((e, i) => (
              <li key={i} className="relative pb-1.5 last:pb-0">
                <span className={cx('absolute -left-[19px] top-1 size-2.5 rounded-full ring-2 ring-white', e.status === 'FAILED' ? 'bg-[#DC2626]' : e.status === 'SKIPPED' ? 'bg-slate-400' : e.status === 'PENDING' ? 'bg-[#F59E0B]' : 'bg-[#25D366]')} />
                <b>{STATUS[e.status] ?? e.status}</b>
                {e.note ? <span className="text-slate-600"> · {e.note}</span> : null}
                <span className="block text-[11px] text-slate-400">
                  {new Date(e.at).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}
                </span>
              </li>
            ))}
          </ol>
          {m.originalText && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] font-semibold text-slate-600">Text before it was edited</summary>
              <div className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-[12px] text-slate-600">{m.originalText}</div>
            </details>
          )}
          <div className="mt-2 text-[11px] text-slate-400">✓ sent · ✓✓ delivered · blue ✓✓ read. WhatsApp reports ticks when the app connects; press “Update ticks” to fetch them now.</div>
        </div>
      )}
    </div>
  )
}

// ================================================================ the inbox
export function WaInbox({
  initialChats,
  initialTo = null,
  linked,
  requestBase = '/requests/',
  profileLinks = true,
  className,
}: {
  initialChats: ChatRow[]
  initialTo?: string | null
  linked: boolean
  /** where a visit opens: '/requests/' on the web, '/m/admin/requests/' in the app (a string — server pages pass it) */
  requestBase?: string
  profileLinks?: boolean
  className?: string
}) {
  const toast = useToast()
  const requestHref = (id: string) => `${requestBase}${id}`
  const [chats, setChats] = useState(initialChats)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [active, setActive] = useState<string | null>(initialTo)
  const [thread, setThread] = useState<Thread | null>(null)
  const [loading, setLoading] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [atBottom, setAtBottom] = useState(true)
  const body = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // ---------------------------------------------------------------- data
  const [ticksAt, setTicksAt] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const loadChats = useCallback(async () => {
    const p = new URLSearchParams({ filter, ...(q.trim() ? { q: q.trim() } : {}) })
    const r = await api<{ chats: ChatRow[]; receiptsAt: string | null }>(`/whatsapp/chats?${p}`).catch(() => null)
    if (r) {
      setChats(r.chats)
      setTicksAt(r.receiptsAt)
    }
  }, [q, filter])
  useEffect(() => {
    const t = setTimeout(loadChats, q ? 300 : 0)
    return () => clearTimeout(t)
  }, [loadChats, q])

  const loadThread = useCallback(async (to: string, older?: string) => {
    const r = await api<Thread>(`/whatsapp/chats/${to}${older ? `?before=${encodeURIComponent(older)}` : ''}`).catch((e) => {
      toast(e.message, 'err')
      return null
    })
    if (!r) return
    setThread((cur) => (older && cur && cur.contact.to === to ? { ...r, items: [...r.items, ...cur.items] } : r))
  }, [toast])

  useEffect(() => {
    if (!active) return setThread(null)
    setLoading(true)
    stick.current = true
    setEdits({})
    loadThread(active).finally(() => setLoading(false))
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('to', active)
      window.history.replaceState(null, '', u)
    } catch {}
  }, [active, loadThread])

  // live: every 15 s, and whenever the Outbox changes (the dock, another tab…)
  useEffect(() => {
    const tick = () => {
      void loadChats()
      if (active) void loadThread(active)
    }
    const t = setInterval(tick, 15_000)
    window.addEventListener('hc:outbox', tick)
    return () => {
      clearInterval(t)
      window.removeEventListener('hc:outbox', tick)
    }
  }, [active, loadChats, loadThread])

  // keep the newest message in view (unless the admin scrolled up to read)
  useEffect(() => {
    const el = body.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [thread])
  const onScroll = () => {
    const el = body.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stick.current = bottom
    setAtBottom(bottom)
  }

  // ---------------------------------------------------------------- actions
  async function act(action: 'send' | 'discard' | 'retry', ms: Msg[]) {
    if (!ms.length) return
    setBusy(ms.length === 1 ? ms[0].id + action : 'all' + action)
    try {
      const changed = Object.fromEntries(ms.filter((m) => edits[m.id] != null && edits[m.id] !== m.text).map((m) => [m.id, edits[m.id]]))
      const r = await api<{ count: number }>('/outbox', { body: { action, ids: ms.map((m) => m.id), ...(action === 'send' && Object.keys(changed).length ? { edits: changed } : {}) } })
      toast(action === 'send' ? `Sending ${r.count} message${r.count === 1 ? '' : 's'}` : action === 'retry' ? 'Trying again' : `${r.count} discarded — not sent`, 'ok')
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !ms.some((m) => m.id === k))))
      outboxChanged()
      if (active) await loadThread(active)
      void loadChats()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  /** fetch the delivered / read ticks from WhatsApp now (a ~15 s session) */
  async function updateTicks() {
    setSyncing(true)
    try {
      const r = await api<{ ok: boolean; changed: number; skipped?: string; receiptsAt: string }>('/whatsapp/receipts', { body: {} })
      if (r.ok) toast(r.changed ? `${r.changed} tick${r.changed === 1 ? '' : 's'} updated` : 'Ticks are up to date', 'ok')
      else if (r.skipped === 'busy') toast('WhatsApp is sending right now, ticks come in with it', 'ok')
      else toast(`Could not update ticks: ${r.skipped ?? 'try again'}`, 'err')
      setTicksAt(r.receiptsAt)
      if (active) await loadThread(active)
      void loadChats()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setSyncing(false)
    }
  }

  async function compose() {
    if (!active || !draft.trim()) return
    setBusy('compose')
    try {
      const r = await api<{ status: string; error: string | null }>(`/whatsapp/chats/${active}`, { body: { text: draft.trim() } })
      if (r.status === 'SKIPPED') toast(`Not sent — ${r.error ?? 'blocked'}`, 'err')
      else toast('Sending…', 'ok')
      setDraft('')
      stick.current = true
      await loadThread(active)
      void loadChats()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  // ---------------------------------------------------------------- view data
  const waitingChats = chats.filter((c) => c.waiting > 0)
  const otherChats = chats.filter((c) => c.waiting === 0)
  const waitingTotal = waitingChats.reduce((a, c) => a + c.waiting, 0)
  const pendingHere = thread?.items.filter((m) => m.status === 'PENDING') ?? []
  const contact = thread?.contact ?? (active ? chats.find((c) => c.to === active) ?? null : null)
  const days = useMemo(() => {
    const out: { key: string; label: string; items: Msg[] }[] = []
    for (const m of thread?.items ?? []) {
      const k = dayKey(m.at)
      const d = out[out.length - 1]
      if (d && d.key === k) d.items.push(m)
      else out.push({ key: k, label: dayLabel(m.at), items: [m] })
    }
    return out
  }, [thread])

  const row = (c: ChatRow) => {
    const preview = c.last.file ? `📄 ${c.last.file}` : c.last.text.split('\n').find((l) => l.trim()) ?? ''
    return (
      <button key={c.to} type="button" onClick={() => setActive(c.to)} className={cx('flex w-full items-center gap-3 px-3 text-left transition hover:bg-[#F5F6F6]', active === c.to && 'bg-[#F0F2F5]')}>
        <Avatar name={c.name} size={46} />
        <span className="flex min-w-0 flex-1 flex-col border-b border-[#E9EDEF] py-3">
          <span className="flex items-baseline gap-2">
            <span className={cx('min-w-0 flex-1 truncate text-[15.5px] text-[#111B21]', c.waiting > 0 && 'font-semibold')}>{c.name}</span>
            <span className={cx('flex-none text-[11.5px]', c.waiting > 0 ? 'font-semibold text-[#1DA851]' : 'text-[#667781]')}>{listTime(c.last.at)}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <Ticks status={c.last.status} size={15} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-[#667781]">{preview}</span>
            {c.failed > 0 && <AlertCircle size={16} className="flex-none text-[#DC2626]" aria-label={`${c.failed} failed`} />}
            {c.waiting > 0 && <span className="flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-[#25D366] px-1.5 text-[11.5px] font-bold text-white">{c.waiting}</span>}
          </span>
          {c.role && <span className="mt-0.5 truncate text-[11.5px] text-[#8696A0]">{c.role}</span>}
        </span>
      </button>
    )
  }

  return (
    <div className={cx('flex h-full min-h-0 overflow-hidden bg-white', className)}>
      {/* ============================================================ chats */}
      <aside className={cx('flex min-h-0 w-full flex-col border-r border-[#E9EDEF] bg-white md:w-[360px] md:flex-none xl:w-[400px]', active && 'hidden md:flex')}>
        <div className="flex items-center gap-3 bg-[#F0F2F5] px-4 py-2.5">
          <span className="flex size-10 flex-none items-center justify-center rounded-full bg-[#00A884] text-white">
            <MessageCircle size={21} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold text-[#111B21]">WhatsApp</div>
            <div className="flex items-center gap-1.5 text-[12px] text-[#667781]">
              <span className={cx('size-2 rounded-full', linked ? 'bg-[#25D366]' : 'bg-[#F59E0B]')} />
              {linked ? 'Connected · sends only after approval' : (
                <Link href="/settings#whatsapp" className="font-semibold text-[#B45309] hover:underline">
                  Not linked — scan the QR in Settings
                </Link>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={updateTicks}
            disabled={syncing || !linked}
            className="flex flex-none flex-col items-end rounded-lg px-2 py-1 text-right hover:bg-black/5 disabled:opacity-60"
            title="Fetch delivered / read ticks from WhatsApp now (takes about 15 seconds)"
          >
            <span className="flex items-center gap-1 text-[12px] font-semibold text-[#008069]">
              <RefreshCw size={13} className={cx(syncing && 'animate-spin')} /> {syncing ? 'Updating…' : 'Update ticks'}
            </span>
            <span className="text-[10.5px] text-[#8696A0]">{ticksAt ? `updated ${agoShort(ticksAt)}` : 'not fetched yet'}</span>
          </button>
        </div>
        <div className="border-b border-[#E9EDEF] px-3 py-2">
          <label className="flex h-9 items-center gap-3 rounded-lg bg-[#F0F2F5] px-3">
            <Search size={16} className="text-[#54656F]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number, patient or HC no." className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[#8696A0]" />
            {q && (
              <button type="button" onClick={() => setQ('')} className="text-[#54656F]" aria-label="Clear">
                <X size={15} />
              </button>
            )}
          </label>
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            {(
              [
                ['all', 'All'],
                ['waiting', `Waiting${waitingTotal ? ` ${waitingTotal}` : ''}`],
                ['sent', 'Sent'],
                ['failed', 'Failed'],
                ['discarded', 'Not sent'],
              ] as [Filter, string][]
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={cx('h-8 flex-none rounded-full px-3 text-[13px] font-medium transition', filter === k ? 'bg-[#D9FDD3] text-[#008069]' : 'bg-[#F0F2F5] text-[#54656F] hover:bg-[#E9EDEF]')}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!chats.length ? (
            <div className="px-6 py-14 text-center text-[13.5px] text-[#667781]">{q || filter !== 'all' ? 'No chats match.' : 'No WhatsApp messages yet.'}</div>
          ) : filter === 'all' && waitingChats.length > 0 ? (
            <>
              <div className="flex items-center gap-1.5 bg-[#FFF8E1] px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-[#B45309]">
                <Clock3 size={12} /> Waiting for approval · {waitingTotal}
              </div>
              {waitingChats.map(row)}
              {otherChats.length > 0 && <div className="bg-[#F7F8FA] px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-[#667781]">All chats</div>}
              {otherChats.map(row)}
            </>
          ) : (
            chats.map(row)
          )}
        </div>
      </aside>

      {/* ============================================================ conversation */}
      <section className={cx('relative min-h-0 min-w-0 flex-1 flex-col', active ? 'flex' : 'hidden md:flex')}>
        {!active || !contact ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 border-b-[6px] border-[#25D366] bg-[#F0F2F5] px-8 text-center">
            <span className="flex size-24 items-center justify-center rounded-full bg-white text-[#00A884] shadow-sm">
              <MessageCircle size={48} />
            </span>
            <div className="text-[26px] font-light text-[#41525D]">Unico HomeCare WhatsApp</div>
            <p className="max-w-[460px] text-[14px] leading-[21px] text-[#667781]">
              Every WhatsApp the system writes waits here until you approve it. Pick a chat to read its full history — sent, delivered, read, failed or not sent — and to send, edit or write a new message.
            </p>
            <div className="mt-2 flex items-center gap-1.5 text-[12.5px] text-[#8696A0]">
              <ShieldCheck size={14} /> Nothing is sent without an admin
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-l border-[#E9EDEF] bg-[#F0F2F5] px-3 py-2.5 md:px-4">
              <button type="button" onClick={() => setActive(null)} className="flex size-9 items-center justify-center rounded-full text-[#54656F] hover:bg-black/5 md:hidden" aria-label="Back to chats">
                <ArrowLeft size={20} />
              </button>
              <Avatar name={contact.name} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15.5px] font-semibold text-[#111B21]">{contact.name}</div>
                <div className="truncate text-[12.5px] text-[#667781]">{[contact.role, fmtPhone(contact.to)].filter(Boolean).join(' · ')}</div>
              </div>
              {profileLinks && thread?.contact.href && (
                <Link href={thread.contact.href} className="hidden h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[#54656F] hover:bg-black/5 sm:flex" title="Open profile">
                  <UserRound size={16} /> Profile
                </Link>
              )}
              <a href={`https://wa.me/${contact.to}`} target="_blank" rel="noreferrer" className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[#008069] hover:bg-black/5" title="Open this chat in WhatsApp">
                <ExternalLink size={15} /> <span className="hidden sm:inline">WhatsApp</span>
              </a>
            </header>

            <div ref={body} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto bg-[#EFEAE2] bg-[radial-gradient(rgba(0,0,0,.045)_1px,transparent_1px)] px-3 py-3 [background-size:16px_16px] md:px-[6%]">
              {loading && !thread ? (
                <div className="flex justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-[#8696A0]" />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {thread?.hasMore && (
                    <button type="button" onClick={() => ((stick.current = false), loadThread(contact.to, thread.items[0]?.at))} className="mx-auto mb-1 rounded-full bg-white/90 px-3 py-1 text-[12.5px] font-semibold text-[#008069] shadow-sm hover:bg-white">
                      Load earlier messages
                    </button>
                  )}
                  <div className="mx-auto mb-1 max-w-[460px] rounded-lg bg-[#FFEECD] px-3 py-1.5 text-center text-[12px] leading-[17px] text-[#54656F] shadow-sm">
                    <ShieldCheck size={12} className="mr-1 inline" /> Messages from Unico HomeCare. Each one is sent only after an admin approves it.
                  </div>
                  {days.map((d) => (
                    <div key={d.key} className="flex flex-col gap-2">
                      <div className="sticky top-1 z-10 mx-auto my-1 rounded-lg bg-white/95 px-3 py-1 text-[12px] font-medium uppercase tracking-wide text-[#54656F] shadow-sm">{d.label}</div>
                      {d.items.map((m) => (
                        <Bubble key={m.id} m={m} requestHref={requestHref} busy={busy} edit={edits[m.id]} onEdit={(t) => setEdits((x) => (t == null ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== m.id)) : { ...x, [m.id]: t }))} onAct={(a) => act(a, [m])} />
                      ))}
                    </div>
                  ))}
                  {!thread?.items.length && !loading && <div className="py-10 text-center text-[13px] text-[#667781]">No messages to this number yet.</div>}
                </div>
              )}
            </div>
            {!atBottom && (
              <button type="button" onClick={() => body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' })} className="absolute bottom-24 right-5 flex size-10 items-center justify-center rounded-full bg-white text-[#54656F] shadow-md" aria-label="Scroll to the newest">
                <ChevronDown size={20} />
              </button>
            )}

            {/* waiting for approval: one tap for all of this chat */}
            {pendingHere.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[#F5E1B8] bg-[#FFF8E1] px-4 py-2">
                <Clock3 size={15} className="text-[#B45309]" />
                <span className="text-[13px] font-semibold text-[#92400E]">{pendingHere.length} waiting for your approval</span>
                <button type="button" disabled={!!busy} onClick={() => act('discard', pendingHere)} className="ml-auto inline-flex h-8 items-center gap-1 rounded-full bg-white px-3 text-[12.5px] font-semibold text-[#B91C1C] shadow-sm disabled:opacity-50">
                  {busy === 'alldiscard' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Don’t send
                </button>
                <button type="button" disabled={!!busy} onClick={() => act('send', pendingHere)} className="inline-flex h-8 items-center gap-1 rounded-full bg-[#25D366] px-3.5 text-[12.5px] font-bold text-white shadow-sm disabled:opacity-50">
                  {busy === 'allsend' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send all {pendingHere.length}
                </button>
              </div>
            )}

            {/* type a message */}
            <form
              className="flex items-end gap-2 bg-[#F0F2F5] px-3 py-2.5"
              onSubmit={(e) => {
                e.preventDefault()
                void compose()
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void compose()
                  }
                }}
                rows={Math.min(5, Math.max(1, draft.split('\n').length))}
                maxLength={1500}
                placeholder={`Type a message to ${contact.name.split(' (')[0]}`}
                className="max-h-32 min-h-[42px] flex-1 resize-none rounded-lg bg-white px-3.5 py-2.5 text-[14.5px] leading-[20px] text-[#111B21] outline-none placeholder:text-[#8696A0]"
              />
              <button type="submit" disabled={!draft.trim() || busy === 'compose'} className="flex size-[42px] flex-none items-center justify-center rounded-full bg-[#00A884] text-white shadow-sm transition hover:bg-[#008F72] disabled:bg-[#8696A0]" aria-label="Send" title="Send now (Enter) — typing it counts as your approval">
                {busy === 'compose' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}
