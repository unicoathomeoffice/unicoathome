'use client'
// Settings → WhatsApp: the messages waiting to go out (cancel one, several or all) or the ones that failed in the last
// 7 days (send again). Opened from the "queued" / "failed" tiles.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, Loader2, RotateCcw, X, Zap } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

type Item = { id: string; to: string; toName: string | null; templateKey: string | null; text: string; file: string | null; requestId: string | null; requestNo: string | null; at: string; urgent: boolean; attempts: number; error: string | null }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const label = (k: string | null) => (k ? k.replace(/_/g, ' ') : 'message')

export function WaQueueDrawer({ status, onClose, onChanged }: { status: 'QUEUED' | 'FAILED'; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const [items, setItems] = useState<Item[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const queued = status === 'QUEUED'

  async function load() {
    try {
      setItems((await api<{ items: Item[] }>(`/settings/whatsapp/queue?status=${status}`)).items)
      setPicked([])
    } catch (e: any) {
      toast(e.message, 'err')
      setItems([])
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function act(ids: string[] | 'ALL', key: string) {
    if (queued && ids === 'ALL' && !confirm(`Cancel all ${items?.length ?? 0} waiting messages? They will not be sent.`)) return
    setBusy(key)
    try {
      const r = await api<{ count: number }>('/settings/whatsapp/queue', { body: { action: queued ? 'cancel' : 'retry', ids } })
      toast(queued ? `${r.count} message${r.count === 1 ? '' : 's'} cancelled` : `${r.count} message${r.count === 1 ? '' : 's'} queued again`, 'ok')
      await load()
      onChanged()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  const all = items ?? []
  return (
    <Drawer
      open
      onClose={onClose}
      width={560}
      title={queued ? `Waiting to send · ${all.length}` : `Failed · last 7 days · ${all.length}`}
      sub={queued ? 'Urgent ones go first. Messages wait for the sending limits, quiet hours or a connection.' : 'Send again puts them back in the queue.'}
      footer={
        all.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2.5">
            {picked.length > 0 && (
              <button type="button" disabled={!!busy} onClick={() => act(picked, 'picked')} className={btnClass(queued ? 'o' : 'p', 'md', queued ? 'text-[#B91C1C]' : '')}>
                {busy === 'picked' ? <Loader2 size={16} className="animate-spin" /> : queued ? <X size={16} /> : <RotateCcw size={16} />} {queued ? 'Cancel' : 'Send again'} {picked.length} selected
              </button>
            )}
            {queued && (
              <button type="button" disabled={!!busy} onClick={() => act('ALL', 'all')} className={btnClass('r', 'md')}>
                {busy === 'all' ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />} Cancel all
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      {!items ? (
        <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      ) : !all.length ? (
        <div className="py-10 text-center text-[14px] text-slate-500">{queued ? 'Nothing waiting — every message has gone out.' : 'No failed messages in the last 7 days.'}</div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 px-1 text-[12.5px] text-slate-500">
            <input type="checkbox" className="size-4 accent-[#0090CA]" checked={picked.length === all.length} onChange={(e) => setPicked(e.target.checked ? all.map((i) => i.id) : [])} /> Select all
          </label>
          {all.map((m) => (
            <div key={m.id} className={cx('rounded-xl border p-3', picked.includes(m.id) ? 'border-primary bg-primary-50/40' : 'border-slate-200')}>
              <div className="flex items-start gap-2.5">
                <input type="checkbox" className="mt-1 size-4 flex-none accent-[#0090CA]" checked={picked.includes(m.id)} onChange={() => setPicked((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]))} aria-label="Select" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px]">
                    <b className="truncate">{m.toName ?? `+${m.to}`}</b>
                    {m.toName && <span className="text-[12px] text-slate-500">+{m.to}</span>}
                    {m.urgent && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-[#FEF3C7] px-1.5 py-0.5 text-[10.5px] font-bold text-[#B45309]">
                        <Zap size={10} /> urgent
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12px] text-slate-500">
                    {label(m.templateKey)} · {when(m.at)}
                    {m.requestNo && m.requestId && (
                      <>
                        {' · '}
                        <Link href={`/requests/${m.requestId}`} className="font-semibold text-primary-700 hover:underline">
                          {m.requestNo}
                        </Link>
                      </>
                    )}
                    {m.attempts > 0 && ` · ${m.attempts} attempt${m.attempts === 1 ? '' : 's'}`}
                  </div>
                  {m.file && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11.5px] text-slate-600">
                      <FileText size={12} /> {m.file}
                    </div>
                  )}
                  <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12.5px] text-slate-600">{m.text}</div>
                  {m.error && <div className="mt-1 text-[12px] text-[#B91C1C]">{m.error}</div>}
                </div>
                <button type="button" disabled={!!busy} onClick={() => act([m.id], m.id)} title={queued ? 'Cancel this message' : 'Send again'} className={cx('flex size-8 flex-none items-center justify-center rounded-lg', queued ? 'text-slate-400 hover:bg-[#FEE2E2] hover:text-[#B91C1C]' : 'text-slate-500 hover:bg-primary-50 hover:text-primary-700')}>
                  {busy === m.id ? <Loader2 size={15} className="animate-spin" /> : queued ? <X size={16} /> : <RotateCcw size={15} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}
