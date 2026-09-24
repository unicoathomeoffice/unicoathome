'use client'
// Small interactive pieces used inside the server-rendered request detail tabs.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Clock, Loader2, RotateCw, Trash2, Upload } from 'lucide-react'
import { api, useAction, uploadFile } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx, mmss } from '@/lib/format'

/** Live mm:ss since `from`. Hydration-safe (the shared <Elapsed> can differ by a second between SSR and hydration). */
export function Tick({ from }: { from: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const sec = Math.max(0, (now - new Date(from).getTime()) / 1000)
  const h = Math.floor(sec / 3600)
  return <span suppressHydrationWarning>{h ? `${h}:${mmss(sec % 3600)}` : mmss(sec)}</span>
}

/** "Elapsed 18:22 · planned 45" pill for a visit in progress */
export function LivePill({ from, planned }: { from: string; planned: number }) {
  const over = (Date.now() - new Date(from).getTime()) / 60000 > planned
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-bold', over ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#FEF3C7] text-[#B45309]')}>
      <Clock size={12} strokeWidth={2.5} />
      Elapsed <Tick from={from} /> · planned {planned}
    </span>
  )
}

/** Expandable row: summary always visible, body on click (email preview). */
export function Expander({ head, children, className }: { head: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cx('border-t border-slate-100 first:border-t-0', className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-5 py-2.5 text-left hover:bg-slate-50">
        <div className="min-w-0 flex-1">{head}</div>
        <ChevronDown size={16} className={cx('flex-none text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && <div className="bg-slate-50 px-5 pb-4 pt-1">{children}</div>}
    </div>
  )
}

export function EmailPreview({ html, text }: { html?: string | null; text?: string | null }) {
  if (html) return <iframe title="Email preview" srcDoc={html} sandbox="" className="h-[420px] w-full rounded-lg border border-slate-200 bg-white" />
  return <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-white p-3 font-sans text-[13px] leading-5 text-slate-700">{text || 'No content stored'}</pre>
}

export function ResendButton({ id }: { id: string }) {
  const { run, busy } = useAction()
  return (
    <button
      type="button"
      disabled={busy}
      className={btnClass('o', 'sm')}
      onClick={(e) => {
        e.stopPropagation()
        run(() => api(`/messages/${id}`, { method: 'PATCH', body: { resend: true } }), 'Email resent')
      }}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />} Resend
    </button>
  )
}

const KINDS = [
  { value: 'PRESCRIPTION', label: 'Prescription' },
  { value: 'REPORT', label: 'Report' },
  { value: 'OTHER', label: 'Other' },
]

export function AttachmentUploader({ requestId }: { requestId: string }) {
  const router = useRouter()
  const { toast } = useAction()
  const input = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState('PRESCRIPTION')
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    try {
      for (const f of Array.from(files)) await uploadFile(f, { kind, requestId, caption: caption.trim() || undefined })
      toast(files.length > 1 ? `${files.length} files uploaded` : 'File uploaded', 'ok')
      setCaption('')
      router.refresh()
    } catch (e: any) {
      toast(e?.message ?? 'Upload failed', 'err')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <div className="flex flex-wrap items-end gap-2.5">
      <label className="w-[160px]">
        <span className="hc-label">Kind</span>
        <select className="hc-input" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-[200px] flex-1">
        <span className="hc-label">Caption (optional)</span>
        <input className="hc-input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Prescription from Dr. Imran" />
      </label>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      <button type="button" className={btnClass('p', 'md', 'h-10')} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Upload file
      </button>
    </div>
  )
}

export function DeleteAttachment({ id, name }: { id: string; name: string }) {
  const { run, busy } = useAction()
  return (
    <button
      type="button"
      title="Delete"
      disabled={busy}
      className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 text-[#B91C1C] hover:bg-[#FEF2F2]"
      onClick={() => {
        if (!window.confirm(`Delete ${name}? It stays in the audit log.`)) return
        run(() => api(`/attachments/${id}`, { method: 'DELETE' }), 'File deleted')
      }}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
    </button>
  )
}
