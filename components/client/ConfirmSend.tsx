'use client'
// "Send this?" — the confirmation window shown before anything is sent on WhatsApp by hand: who gets it, the exact
// message (read-only), the files, and whether WhatsApp is linked right now. Nothing is sent until "Yes, send".
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, FileText, Loader2, MessageCircle, Send } from 'lucide-react'
import { btnClass } from '@/components/ui'
import { phone as fmtPhone } from '@/lib/format'
import { reviewActive } from './WaReview'

export type ConfirmSendOptions = {
  title: string
  to: { name: string; phone?: string | null; note?: string }[]
  /** the exact text, or a loader for it (template preview) */
  message?: string | (() => Promise<string>)
  files?: string[]
  /** WhatsApp linked right now? false → "it waits in the queue until WhatsApp is linked" */
  linked?: boolean
  note?: ReactNode
  confirmLabel?: string
}

function Dialog({ o, onDone }: { o: ConfirmSendOptions; onDone: (ok: boolean) => void }) {
  const [text, setText] = useState<string | null>(typeof o.message === 'string' ? o.message : null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (typeof o.message !== 'function') return
    let live = true
    o.message().then(
      (t) => live && setText(t),
      (e) => live && setErr(e?.message ?? 'Could not load the message'),
    )
    return () => {
      live = false
    }
  }, [o])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone(false)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onDone])

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label={o.title}>
      <div className="absolute inset-0" onClick={() => onDone(false)} />
      <div className="relative flex max-h-[88dvh] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl bg-white shadow-drawer">
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
          <span className="flex size-9 flex-none items-center justify-center rounded-full bg-[#DCFCE7] text-[#15803D]">
            <MessageCircle size={18} />
          </span>
          <div className="text-[16px] font-bold leading-snug">{o.title}</div>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4 text-[13.5px]">
          <div>
            <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[.06em] text-slate-500">To · {o.to.length}</div>
            <ul className="flex flex-col gap-1">
              {o.to.map((p, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <b>{p.name}</b>
                  {p.phone && <span className="text-slate-500">{fmtPhone(p.phone)}</span>}
                  {p.note && <span className="text-[12px] text-slate-400">· {p.note}</span>}
                </li>
              ))}
              {!o.to.length && <li className="text-[#B45309]">Nobody — check the recipients</li>}
            </ul>
          </div>
          {!!o.files?.length && (
            <div>
              <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[.06em] text-slate-500">Files</div>
              {o.files.map((f) => (
                <div key={f} className="flex items-center gap-1.5 text-slate-700">
                  <FileText size={14} className="text-slate-400" /> {f}
                </div>
              ))}
            </div>
          )}
          {o.message !== undefined && (
            <div>
              <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[.06em] text-slate-500">Message</div>
              <div className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#F0FDF4] px-3 py-2.5 text-[13px] leading-[19px] text-slate-800 ring-1 ring-[#BBF7D0]">
                {err ? <span className="text-[#B91C1C]">{err}</span> : text ?? <Loader2 size={15} className="animate-spin text-slate-400" />}
              </div>
            </div>
          )}
          {o.linked === false && (
            <div className="flex gap-2 rounded-lg bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">
              <AlertTriangle size={15} className="mt-0.5 flex-none" /> WhatsApp isn’t linked right now — this waits in the queue and goes out as soon as it is linked again (Settings → WhatsApp).
            </div>
          )}
          {o.note && <div className="text-[12.5px] text-slate-500">{o.note}</div>}
        </div>
        <div className="flex justify-end gap-2.5 border-t border-slate-100 px-5 py-3.5">
          <button type="button" className={btnClass('o')} onClick={() => onDone(false)}>
            Cancel
          </button>
          <button type="button" autoFocus className={btnClass('g')} disabled={!o.to.length} onClick={() => onDone(true)}>
            <Send size={16} /> {o.confirmLabel ?? 'Yes, send'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** `const { confirmSend, confirmDialog } = useConfirmSend()` · `if (!(await confirmSend({...}))) return` · render {confirmDialog}. */
export function useConfirmSend() {
  const [st, setSt] = useState<null | { o: ConfirmSendOptions; resolve: (ok: boolean) => void }>(null)
  // with the Outbox on, the action's messages open in the "Review & send" window right after the click (real text per
  // recipient, editable) — asking here as well would ask twice
  const confirmSend = (o: ConfirmSendOptions) => (reviewActive() ? Promise.resolve(true) : new Promise<boolean>((resolve) => setSt({ o, resolve })))
  const confirmDialog = st ? (
    <Dialog
      o={st.o}
      onDone={(ok) => {
        st.resolve(ok)
        setSt(null)
      }}
    />
  ) : null
  return { confirmSend, confirmDialog }
}
