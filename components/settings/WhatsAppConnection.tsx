'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, QrCode, RefreshCw, Send, Unplug, XCircle } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { ago } from '@/lib/format'

export type WaStatus = { paired: boolean; phone: string | null; queued: number; failed7d: number; lastSentAt: string | null; lastError: string | null; lastErrorAt: string | null; pairedAt: string | null }

/** Settings → WhatsApp: pair the hospital's WhatsApp by QR (no server needed), auto-send switch, test, queue. */
export function WhatsAppConnection({ initial, autoSend: initialAuto }: { initial: WaStatus; autoSend: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [st, setSt] = useState(initial)
  const [autoSend, setAutoSend] = useState(initialAuto)
  const [qr, setQr] = useState<string | null>(null)
  const [pairing, setPairing] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [testTo, setTestTo] = useState('')
  const es = useRef<EventSource | null>(null)

  useEffect(() => () => es.current?.close(), [])

  async function refresh() {
    try {
      const r = await api<{ status: WaStatus; autoSend: boolean }>('/settings/whatsapp')
      setSt(r.status)
      setAutoSend(r.autoSend)
    } catch {}
  }

  function connect() {
    es.current?.close()
    setQr(null)
    setNote('Opening a WhatsApp session…')
    setPairing(true)
    const s = new EventSource('/api/v1/settings/whatsapp/pair')
    es.current = s
    s.onmessage = (ev) => {
      const d = JSON.parse(ev.data)
      if (d.qr) {
        setQr(d.qr)
        setNote('On your phone: WhatsApp → ⋮ → Linked devices → Link a device, then scan.')
      }
      if (d.paired) {
        setQr(null)
        setNote('')
        toast(`WhatsApp connected${d.phone ? ` · +${d.phone}` : ''}`, 'ok')
        refresh()
        router.refresh()
      }
      if (d.error) {
        setQr(null)
        setNote(d.error)
        toast(d.error, 'err')
      }
      if (d.done) {
        s.close()
        setPairing(false)
      }
    }
    s.onerror = () => {
      s.close()
      setPairing(false)
      setNote((n) => n || 'Connection dropped — click Connect again')
    }
  }

  async function act(action: 'pump' | 'disconnect' | 'test') {
    if (action === 'disconnect' && !confirm('Disconnect WhatsApp? Automatic messages stop until you scan again.')) return
    setBusy(action)
    try {
      const r = await api<any>('/settings/whatsapp', { method: 'POST', body: action === 'test' ? { action, to: testTo } : { action } })
      if (action === 'test') toast(r.sent ? 'Test message sent' : `Queued · ${r.skipped ?? 'will send shortly'}`, r.sent ? 'ok' : 'err')
      if (action === 'pump') toast(`Sent ${r.sent}${r.failed ? ` · failed ${r.failed}` : ''}${r.skipped ? ` · ${r.skipped}` : ''}`, r.sent || !r.skipped ? 'ok' : 'err')
      if (action === 'disconnect') toast('WhatsApp disconnected', 'ok')
      await refresh()
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  async function toggleAuto(v: boolean) {
    setAutoSend(v)
    try {
      await api('/settings/whatsapp', { method: 'PATCH', body: { autoSend: v } })
      toast(v ? 'Automatic WhatsApp messages on' : 'Automatic WhatsApp messages off', 'ok')
    } catch (e: any) {
      setAutoSend(!v)
      toast(e.message, 'err')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5">
        <span className="text-[13.5px] font-semibold">Hospital WhatsApp</span>
        {st.paired ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#DCFCE7] px-2 text-[11px] font-bold text-[#15803D]">
            <CheckCircle2 size={13} /> CONNECTED{st.phone ? ` · +${st.phone}` : ''}
          </span>
        ) : (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#FFEDD5] px-2 text-[11px] font-bold text-[#C2410C]">
            <XCircle size={13} /> NOT CONNECTED
          </span>
        )}
      </div>

      {qr ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <img src={qr} alt="Scan with WhatsApp" className="size-[260px] rounded-md" />
          <div className="text-center text-[12.5px] text-slate-600">{note}</div>
        </div>
      ) : (
        note && <div className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">{note}</div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={connect} disabled={pairing} className={btnClass(st.paired ? 'o' : 'p', 'md')}>
          {pairing ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />} {st.paired ? 'Re-connect (scan)' : 'Connect · scan QR'}
        </button>
        {st.paired && (
          <button type="button" onClick={() => act('disconnect')} disabled={busy === 'disconnect'} className={btnClass('o', 'md')}>
            {busy === 'disconnect' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
          </button>
        )}
      </div>

      <div className="flex items-center justify-between py-1">
        <span className="text-[13.5px]">
          <span className="font-semibold">Send WhatsApp automatically</span>
          <span className="block text-[12px] text-slate-500">Request received, confirmed, assigned, rescheduled, cancelled, completed — per Notification rules</span>
        </span>
        <Toggle on={autoSend} onChange={toggleAuto} label="Send WhatsApp automatically" />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-[18px] font-bold text-slate-900">{st.queued}</div>
          queued
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-[18px] font-bold text-slate-900">{st.failed7d}</div>
          failed · 7 d
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-[13px] font-bold text-slate-900">{st.lastSentAt ? ago(st.lastSentAt) : '—'}</div>
          last sent
        </div>
      </div>
      {st.lastError && (
        <div className="rounded-lg bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">
          Last problem{st.lastErrorAt ? ` (${ago(st.lastErrorAt)})` : ''}: {st.lastError}
        </div>
      )}

      {st.paired && (
        <>
          <div className="flex gap-2">
            <input className="hc-input" placeholder="Test number · 01XXXXXXXXX" value={testTo} onChange={(e) => setTestTo(e.target.value)} inputMode="tel" />
            <button type="button" onClick={() => act('test')} disabled={busy === 'test' || !testTo} className={btnClass('o', 'md', 'flex-none')}>
              {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Test
            </button>
          </div>
          <button type="button" onClick={() => act('pump')} disabled={busy === 'pump' || !st.queued} className="inline-flex items-center gap-1.5 self-start text-[13px] font-semibold text-primary-700 disabled:text-slate-400">
            {busy === 'pump' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Send queued now
          </button>
        </>
      )}
      <p className="text-[12px] leading-[18px] text-slate-500">
        Uses the hospital number like WhatsApp Web (unofficial WhatsApp Web protocol, no VPS). Keep the phone online. Messages go out in short bursts right after each event; if a burst can’t connect they wait here and go with the next one.
      </p>
    </div>
  )
}
