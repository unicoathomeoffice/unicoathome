'use client'
// The WhatsApp Outbox (web /outbox and phone /m/admin/outbox): every message waiting for approval, grouped by visit.
// Preview, edit, send or discard — one by one or many at once.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, Send, Trash2 } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { OutboxCards, bulk, type OutboxItem } from '@/components/client/WaReview'
import { btnClass } from '@/components/ui'

export function OutboxPanel({ initial, linked, requestHref = (id: string) => `/requests/${id}` }: { initial: OutboxItem[]; linked: boolean; requestHref?: (id: string) => string }) {
  const router = useRouter()
  const toast = useToast()
  const [items, setItems] = useState(initial)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'send' | 'discard' | null>(null)

  useEffect(() => {
    let live = true
    const load = () =>
      api<{ items: OutboxItem[] }>('/outbox')
        .then((r) => {
          if (!live) return
          setItems(r.items)
          setSel((s) => new Set([...s].filter((id) => r.items.some((m) => m.id === id))))
        })
        .catch(() => {})
    const t = setInterval(load, 20_000)
    window.addEventListener('hc:outbox', load)
    return () => {
      live = false
      clearInterval(t)
      window.removeEventListener('hc:outbox', load)
    }
  }, [])

  // one group per visit (messages not about a visit — daily summary, logins — go last)
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; title: string; requestId: string | null; requestNo: string | null; items: OutboxItem[] }>()
    for (const it of items) {
      const key = it.requestId ?? 'other'
      if (!m.has(key)) m.set(key, { key, title: it.visit ?? 'Not about one visit', requestId: it.requestId, requestNo: it.requestNo, items: [] })
      m.get(key)!.items.push(it)
    }
    return [...m.values()].sort((a, b) => Number(a.key === 'other') - Number(b.key === 'other'))
  }, [items])

  const chosen = sel.size ? items.filter((m) => sel.has(m.id)) : items
  async function all(action: 'send' | 'discard') {
    if (!chosen.length) return
    if (action === 'discard' && !confirm(`Discard ${chosen.length} message${chosen.length === 1 ? '' : 's'}? They will not be sent.`)) return
    setBusy(action)
    try {
      const n = await bulk(action, chosen, edits)
      toast(action === 'send' ? `Sending ${n} WhatsApp message${n === 1 ? '' : 's'}` : `${n} discarded — not sent`, 'ok')
      const gone = new Set(chosen.map((m) => m.id))
      setItems((x) => x.filter((m) => !gone.has(m.id)))
      setSel(new Set())
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  const drop = (ids: string[]) => setItems((x) => x.filter((m) => !ids.includes(m.id)))
  const pick = (id: string, on: boolean) =>
    setSel((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  return (
    <div className="flex flex-col gap-4">
      {!linked && (
        <div className="flex gap-2 rounded-lg bg-[#FEF3C7] px-3.5 py-2.5 text-[13px] text-[#92400E]">
          <AlertTriangle size={16} className="mt-0.5 flex-none" />
          <span>
            WhatsApp isn’t linked right now — approved messages wait and go out as soon as it is linked again (Settings → WhatsApp).
          </span>
        </div>
      )}
      {items.length ? (
        <>
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2.5 rounded-card bg-white px-4 py-3 shadow-card">
            <label className="flex items-center gap-2 text-[13.5px]">
              <input type="checkbox" className="size-4 accent-[#0090CA]" checked={sel.size === items.length} onChange={(e) => setSel(e.target.checked ? new Set(items.map((m) => m.id)) : new Set())} />
              {sel.size ? `${sel.size} selected` : `${items.length} waiting`}
            </label>
            <span className="hidden text-[12.5px] text-slate-500 sm:inline">Tap a message to edit it before sending.</span>
            <button type="button" className={btnClass('o', 'sm', 'ml-auto text-[#B91C1C]')} disabled={!!busy} onClick={() => all('discard')}>
              {busy === 'discard' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Discard {sel.size ? 'selected' : 'all'}
            </button>
            <button type="button" className={btnClass('g', 'sm')} disabled={!!busy} onClick={() => all('send')}>
              {busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send {sel.size ? `${sel.size} selected` : `all ${items.length}`}
            </button>
          </div>
          {groups.map((g) => (
            <section key={g.key}>
              <div className="mb-1.5 flex items-baseline gap-2 px-1">
                <h2 className="truncate text-[14px] font-bold">{g.title}</h2>
                {g.requestId && (
                  <Link href={requestHref(g.requestId)} className="flex-none text-[12px] font-semibold text-primary-700 hover:underline">
                    {g.requestNo ?? 'Open'} ›
                  </Link>
                )}
                <span className="ml-auto flex-none text-[12px] text-slate-500">{g.items.length}</span>
              </div>
              <OutboxCards items={g.items} showVisit={false} onDone={drop} edits={edits} setEdits={setEdits} selectable selected={sel} onSelect={pick} />
            </section>
          ))}
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-card bg-white px-6 py-14 text-center shadow-card">
          <CheckCircle2 size={28} className="text-[#15803D]" />
          <div className="text-[15px] font-bold">Nothing waiting</div>
          <div className="max-w-[420px] text-[13px] text-slate-500">Every WhatsApp the system prepares — patient, staff, department heads, security, live updates — waits here until you send it.</div>
        </div>
      )}
    </div>
  )
}
