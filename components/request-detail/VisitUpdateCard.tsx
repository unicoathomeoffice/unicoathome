'use client'
// Request page: the auto-generated short visit update — copy it, or send it on WhatsApp to the chosen people.
import { useState } from 'react'
import { Check, ChevronDown, Copy, Loader2, RefreshCw, Send } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

type Preview = { text: string; patientText: string; sentAt: string | null }

export function VisitUpdateCard({ requestId, waPaired, canSend, autoSentAt }: { requestId: string; waPaired: boolean; canSend: boolean; autoSentAt: string | null }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [p, setP] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pick, setPick] = useState({ hods: true, extra: true, staff: false, patient: false })

  async function load() {
    setLoading(true)
    try {
      setP(await api<Preview>(`/requests/${requestId}/update`))
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setLoading(false)
    }
  }
  async function send() {
    setSending(true)
    try {
      const r = await api<{ sent: number }>(`/requests/${requestId}/update`, { body: pick })
      toast(r.sent ? `Update sent to ${r.sent} on WhatsApp` : 'Nobody to send to — add department heads / update numbers in Settings → Notification rules', r.sent ? 'ok' : 'err')
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setSending(false)
    }
  }
  const box = (k: keyof typeof pick, label: string) => (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" className="size-4 accent-[#0090CA]" checked={pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} /> {label}
    </label>
  )
  return (
    <section className="rounded-card bg-white px-4 py-3 shadow-card">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          if (!p && !loading) load()
        }}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="text-base font-bold">Visit update</span>
        <span className="text-[12.5px] text-slate-500">{autoSentAt ? `· sent automatically ${new Date(autoSentAt).toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })}` : '· short summary for WhatsApp'}</span>
        <ChevronDown size={18} className={cx('ml-auto text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_260px]">
          <div className="min-h-[120px] whitespace-pre-wrap rounded-lg bg-slate-50 px-3.5 py-3 text-[13.5px] leading-[21px] ring-1 ring-slate-200">{loading ? <Loader2 size={16} className="animate-spin text-slate-400" /> : (p?.text ?? '')}</div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={!p}
              onClick={async () => {
                await navigator.clipboard.writeText(p!.text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className={btnClass('o', 'md', 'w-full')}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy text'}
            </button>
            <button type="button" onClick={load} disabled={loading} className={btnClass('o', 'md', 'w-full')}>
              <RefreshCw size={16} /> Regenerate
            </button>
            {canSend && (
              <div className="rounded-lg border border-slate-200 p-2.5">
                <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">Send on WhatsApp to</div>
                <div className="flex flex-col gap-1.5">
                  {box('hods', 'Heads of department')}
                  {box('extra', 'Update numbers (Settings)')}
                  {box('staff', 'Care team')}
                  {box('patient', 'Patient (friendly version)')}
                </div>
                <button type="button" disabled={!waPaired || sending || !Object.values(pick).some(Boolean)} onClick={send} className={btnClass('g', 'md', 'mt-2.5 w-full')}>
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send update
                </button>
                {!waPaired && <div className="mt-1.5 text-[12px] text-[#B45309]">WhatsApp is not paired — copy the text instead, or pair it in Settings.</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
