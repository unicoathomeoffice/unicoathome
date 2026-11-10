'use client'
// Request page: the Unico car paperwork — Vehicle Requisition Form and gate pass — view, and resend to the
// on-call security supervisor.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Car, Eye, Loader2, Send } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { useConfirmSend } from '@/components/client/ConfirmSend'

export function TransportDocsBox({ requestId, requestNo, requisitionId, gatePassId, sentAt, sent, canSend, to = [], linked = true, assigned = true }: { requestId: string; requestNo?: string; requisitionId: string | null; gatePassId: string | null; sentAt: string | null; sent: { to: string; status: string; at: string; templateKey: string }[]; canSend: boolean; to?: { name: string; phone?: string }[]; linked?: boolean; /** care team assigned: the requisition names them, so it is made only then */ assigned?: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const { confirmSend, confirmDialog } = useConfirmSend()
  const [busy, setBusy] = useState(false)
  const ok = (s: string) => ['SENT', 'DELIVERED', 'SENT_CONFIRMED'].includes(s)
  const last = (k: string) => sent.find((m) => m.templateKey === k)
  const line = (k: string) => {
    const m = last(k)
    return !m ? 'not sent' : ok(m.status) ? `sent ✓ ${new Date(m.at).toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })}` : m.status === 'FAILED' ? 'failed' : m.status === 'PENDING' ? 'waiting for approval (Outbox)' : m.status === 'SKIPPED' ? 'not sent' : m.status === 'QUEUED' && !linked ? 'waiting for WhatsApp link' : 'sending…'
  }
  async function resend() {
    const ok = await confirmSend({
      title: `${sentAt ? 'Send the car paperwork again' : 'Make and send the car paperwork'} to security?`,
      to: to.map((p) => ({ ...p, note: 'security supervisor' })),
      files: [`Vehicle requisition${requestNo ? ` · ${requestNo}` : ''} (PDF)`, ...(gatePassId ? ['Gate pass (PDF)'] : [])],
      linked,
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await api<{ sent: number }>(`/requests/${requestId}/transport-docs`, { body: {} })
      toast(r.sent ? `Sent to the security supervisor (${r.sent} file${r.sent === 1 ? '' : 's'})` : 'Made the forms — not sent (no supervisor set or WhatsApp not paired)', r.sent ? 'ok' : 'err')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-white px-3.5 py-2.5 text-[13px] shadow-card">
      <Car size={16} className="flex-none text-primary-700" />
      <span className="font-semibold">Unico car paperwork</span>
      {requisitionId ? (
        <a href={`/api/v1/attachments/${requisitionId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-700 hover:underline">
          <Eye size={14} /> Requisition form
        </a>
      ) : (
        <span className="text-slate-400">{assigned ? 'Requisition not made yet' : 'Requisition goes to the security supervisor once staff are assigned'}</span>
      )}
      <span className="text-slate-500">· {line('vehicle_requisition')}</span>
      {gatePassId && (
        <>
          <a href={`/api/v1/attachments/${gatePassId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-700 hover:underline">
            <Eye size={14} /> Gate pass
          </a>
          <span className="text-slate-500">· {line('gate_pass')}</span>
        </>
      )}
      {canSend && (assigned || !!requisitionId) && (
        <button type="button" disabled={busy} onClick={resend} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {sentAt ? 'Resend' : 'Make & send'} to security
        </button>
      )}
      {confirmDialog}
    </div>
  )
}
