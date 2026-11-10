'use client'
// Patient confirmation on WhatsApp. Who gets it is ticked in "Notify on WhatsApp" (components/client/NotifyPicker).
// Paired WhatsApp: the server sends it from the hospital number. Not paired: the caller opens a pre-filled wa.me chat
// after confirming (reserveTab + openConfirmLink below).
import { useState } from 'react'
import { Loader2, MessageCircle } from 'lucide-react'
import { api } from '@/components/client'
import { useConfirmSend } from '@/components/client/ConfirmSend'

export type WaInfo = { paired: boolean; phone: string; optOut: boolean }

/** Not paired: open a tab synchronously in the click (no popup blocker), then point it at the wa.me chat. */
export function reserveTab(wa: WaInfo, send: boolean) {
  return send && !wa.paired && !wa.optOut && wa.phone ? window.open('about:blank', '_blank') : null
}
export async function openConfirmLink(tab: Window | null, requestId: string) {
  if (!tab) return
  try {
    const r = await api<{ url: string }>('/messages/whatsapp', { body: { requestId, templateKey: 'patient_confirmed', to: 'patient' } })
    tab.location.href = r.url
  } catch {
    tab.close()
  }
}

/** Request page: did the patient get the confirmation on WhatsApp? Send / resend from here. */
export function ConfirmationStatus({ requestId, wa, last, patientName }: { requestId: string; wa: WaInfo; last: { status: string; at: string; error?: string; provider?: string } | null; patientName?: string }) {
  const [busy, setBusy] = useState(false)
  const { confirmSend, confirmDialog } = useConfirmSend()
  const [note, setNote] = useState<string | null>(null)
  const sent = last && ['SENT', 'DELIVERED', 'READ', 'SENT_CONFIRMED'].includes(last.status)
  const at = last ? new Date(last.at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
  const state = !last
    ? { text: 'Not sent yet', cls: 'text-slate-500' }
    : sent
      ? { text: `Sent ✓ ${at}`, cls: 'text-[#15803D]' }
      : last.status === 'PENDING'
        ? { text: `Waiting in the Outbox for approval (${at})`, cls: 'text-[#6D28D9]' }
        : last.status === 'QUEUED'
        ? { text: `Sending… (queued ${at})`, cls: 'text-[#B45309]' }
        : last.status === 'PREPARED'
          ? { text: `Opened in WhatsApp ${at} · not confirmed as sent`, cls: 'text-[#B45309]' }
          : { text: `Failed ${at}${last.error ? ` · ${last.error}` : ''}`, cls: 'text-[#B91C1C]' }
  async function send() {
    const ok = await confirmSend({
      title: `${last ? 'Send the confirmation again' : 'Send the confirmation'} to the patient?`,
      to: [{ name: patientName || 'Patient', phone: wa.phone }],
      message: () => api<{ text: string }>('/messages/whatsapp', { body: { requestId, templateKey: 'patient_confirmed', to: 'patient', preview: true } }).then((r) => r.text),
      linked: wa.paired,
      note: wa.paired ? 'Sent from the hospital WhatsApp number.' : undefined,
      confirmLabel: wa.paired ? 'Yes, send' : 'Yes, open WhatsApp',
    })
    if (!ok) return
    const tab = wa.paired ? null : window.open('about:blank', '_blank')
    setBusy(true)
    setNote(null)
    try {
      const r = await api<{ auto: boolean; url?: string }>('/messages/whatsapp', { body: { requestId, templateKey: 'patient_confirmed', to: 'patient', mode: 'auto' } })
      if (r.auto) {
        tab?.close()
        setNote('Queued — sending from the hospital number')
      } else if (r.url) {
        if (tab) tab.location.href = r.url
        else window.open(r.url, '_blank')
      }
    } catch (e: any) {
      tab?.close()
      setNote(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white px-3.5 py-2 text-[13px] shadow-card">
      <MessageCircle size={16} className="flex-none text-[#16A34A]" />
      <span className="font-semibold">Patient confirmation</span>
      <span className={state.cls}>{wa.optOut ? 'Patient opted out of WhatsApp' : state.text}</span>
      {note && <span className="text-slate-500">· {note}</span>}
      {!wa.optOut && wa.phone && (
        <button type="button" disabled={busy} onClick={send} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          {busy && <Loader2 size={14} className="animate-spin" />} {last ? 'Resend' : 'Send'} on WhatsApp
        </button>
      )}
      {confirmDialog}
    </div>
  )
}
