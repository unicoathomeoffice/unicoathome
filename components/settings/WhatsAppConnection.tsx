'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, QrCode, RefreshCw, Send, Smartphone, Unplug, XCircle } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { ago } from '@/lib/format'
import { WaQueueDrawer } from './WaQueueDrawer'

export type WaStatus = { paired: boolean; state?: 'connected' | 'needs_rescan' | 'not_paired'; stateReason?: string | null; phone: string | null; queued: number; failed7d: number; lastSentAt: string | null; lastError: string | null; lastErrorAt: string | null; pairedAt: string | null; verifiedAt?: string | null }

/** Settings → WhatsApp: pair the hospital's WhatsApp by QR (no server needed), auto-send switch, test, queue. */
export function WhatsAppConnection({ initial, autoSend: initialAuto, approval: initialApproval = true }: { initial: WaStatus; autoSend: boolean; approval?: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [st, setSt] = useState(initial)
  const [autoSend, setAutoSend] = useState(initialAuto)
  const [approval, setApproval] = useState(initialApproval)
  const [qr, setQr] = useState<string | null>(null)
  const [pairing, setPairing] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [testTo, setTestTo] = useState('')
  const [list, setList] = useState<null | 'QUEUED' | 'FAILED'>(null)
  const [code, setCode] = useState<string | null>(null)
  const [byPhone, setByPhone] = useState(false)
  const [linkPhone, setLinkPhone] = useState('')
  const state = st.state ?? (st.paired ? 'connected' : 'not_paired')
  const es = useRef<EventSource | null>(null)

  useEffect(() => () => es.current?.close(), [])

  async function refresh() {
    try {
      const r = await api<{ status: WaStatus; autoSend: boolean; approval: boolean }>('/settings/whatsapp')
      setApproval(r.approval)
      setSt(r.status)
      setAutoSend(r.autoSend)
    } catch {}
  }

  function connect(phone?: string) {
    es.current?.close()
    setQr(null)
    setCode(null)
    setNote('Opening a WhatsApp session…')
    setPairing(true)
    const s = new EventSource(`/api/v1/settings/whatsapp/pair${phone ? `?phone=${encodeURIComponent(phone)}` : ''}`)
    es.current = s
    s.onmessage = (ev) => {
      const d = JSON.parse(ev.data)
      if (d.qr) {
        setQr(d.qr)
        setNote('On your phone: WhatsApp → ⋮ → Linked devices → Link a device, then scan.')
      }
      if (d.code) {
        setCode(d.code)
        setNote('On the hospital phone: WhatsApp → ⋮ → Linked devices → Link a device → Link with phone number instead, then type this code.')
      }
      if (d.note) {
        setQr(null)
        setCode(null)
        setNote(d.note)
      }
      if (d.paired) {
        setQr(null)
        setCode(null)
        setNote('')
        toast(`WhatsApp connected${d.phone ? ` · +${d.phone}` : ''}`, 'ok')
        refresh()
        router.refresh()
      }
      if (d.error) {
        setQr(null)
        setCode(null)
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

  async function act(action: 'pump' | 'disconnect' | 'test' | 'check') {
    if (action === 'disconnect' && !confirm('Disconnect WhatsApp? Automatic messages stop until you scan again.')) return
    setBusy(action)
    try {
      const r = await api<any>('/settings/whatsapp', { method: 'POST', body: action === 'test' ? { action, to: testTo } : { action } })
      if (action === 'test') toast(r.sent ? 'Test message sent' : `Queued · ${r.skipped ?? 'will send shortly'}`, r.sent ? 'ok' : 'err')
      if (action === 'pump') toast(`Sent ${r.sent}${r.failed ? ` · failed ${r.failed}` : ''}${r.skipped ? ` · ${r.skipped}` : ''}`, r.sent || !r.skipped ? 'ok' : 'err')
      if (action === 'disconnect') toast('WhatsApp disconnected', 'ok')
      if (action === 'check') toast(r.ok ? 'WhatsApp is linked and working' : `Not working: ${r.error ?? 'could not connect'} — scan again`, r.ok ? 'ok' : 'err')
      await refresh()
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  async function toggleApproval(v: boolean) {
    if (!v && !confirm('Turn approval off? Automatic WhatsApp messages will then go out on their own, without anyone checking them.')) return
    setApproval(v)
    try {
      await api('/settings/whatsapp', { method: 'PATCH', body: { approval: v } })
      toast(v ? 'Every WhatsApp now waits in the Outbox for approval' : 'WhatsApp messages go out automatically again', 'ok')
    } catch (e: any) {
      setApproval(!v)
      toast(e.message, 'err')
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
        {state === 'connected' ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#DCFCE7] px-2 text-[11px] font-bold text-[#15803D]">
            <CheckCircle2 size={13} /> CONNECTED{st.phone ? ` · +${st.phone}` : ''}
          </span>
        ) : state === 'needs_rescan' ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#FEE2E2] px-2 text-[11px] font-bold text-[#B91C1C]" title={st.stateReason ?? undefined}>
            <AlertTriangle size={13} /> NEEDS RE-SCAN{st.phone ? ` · +${st.phone}` : ''}
          </span>
        ) : (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#FFEDD5] px-2 text-[11px] font-bold text-[#C2410C]">
            <XCircle size={13} /> NOT CONNECTED
          </span>
        )}
      </div>

      {state === 'needs_rescan' && !pairing && (
        <div className="rounded-lg bg-[#FEE2E2] px-3 py-2 text-[12.5px] text-[#B91C1C]">
          The hospital number is not linked any more{st.stateReason ? ` (${st.stateReason})` : ''}. Messages wait in the queue — link it again below.
        </div>
      )}
      {code && (
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-4">
          <div className="font-mono text-[30px] font-bold tracking-[.18em] text-navy">{code}</div>
          <div className="text-center text-[12.5px] text-slate-600">{note}</div>
        </div>
      )}
      {qr ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <img src={qr} alt="Scan with WhatsApp" className="size-[260px] rounded-md" />
          <div className="text-center text-[12.5px] text-slate-600">{note}</div>
        </div>
      ) : (
        note && !code && <div className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">{note}</div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => connect()} disabled={pairing} className={btnClass(state === 'connected' ? 'o' : 'p', 'md')}>
          {pairing && !byPhone ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />} {state === 'connected' ? 'Re-connect (scan)' : 'Connect · scan QR'}
        </button>
        <button type="button" onClick={() => setByPhone((x) => !x)} disabled={pairing} className={btnClass('o', 'md')}>
          <Smartphone size={16} /> Link with phone number
        </button>
        {state === 'connected' && (
          <button type="button" onClick={() => act('check')} disabled={busy === 'check'} className={btnClass('o', 'md')}>
            {busy === 'check' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Check connection
          </button>
        )}
        {st.paired && (
          <button type="button" onClick={() => act('disconnect')} disabled={busy === 'disconnect'} className={btnClass('o', 'md')}>
            {busy === 'disconnect' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
          </button>
        )}
      </div>

      {byPhone && (
        <div className="flex gap-2">
          <input className="hc-input" placeholder="Hospital WhatsApp number · 01XXXXXXXXX" value={linkPhone} onChange={(e) => setLinkPhone(e.target.value)} inputMode="tel" />
          <button type="button" disabled={pairing || linkPhone.replace(/\D/g, '').length < 10} onClick={() => connect(linkPhone)} className={btnClass('p', 'md', 'flex-none')}>
            {pairing && byPhone ? <Loader2 size={16} className="animate-spin" /> : <Smartphone size={16} />} Get code
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 rounded-lg bg-[#F0FDF4] px-3 py-2.5 ring-1 ring-[#BBF7D0]">
        <span className="text-[13.5px]">
          <span className="font-semibold">Send only after approval</span>
          <span className="block text-[12px] text-slate-600">
            Every WhatsApp — patient, staff, department heads, security, live updates, daily summary — waits in the{' '}
            <a href="/outbox" className="font-semibold text-primary-700 hover:underline">
              Outbox
            </a>{' '}
            until an admin checks it, edits it if needed and sends it.
          </span>
        </span>
        <Toggle on={approval} onChange={toggleApproval} label="Send only after approval" />
      </div>

      <div className="flex items-center justify-between py-1">
        <span className="text-[13.5px]">
          <span className="font-semibold">Send WhatsApp automatically</span>
          <span className="block text-[12px] text-slate-500">Request received, confirmed, assigned, rescheduled, cancelled, completed — per Notification rules</span>
        </span>
        <Toggle on={autoSend} onChange={toggleAuto} label="Send WhatsApp automatically" />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
        <button type="button" onClick={() => setList('QUEUED')} className="rounded-lg bg-slate-50 p-2 transition hover:bg-primary-50 hover:ring-1 hover:ring-primary/30" title="See and cancel waiting messages">
          <div className="text-[18px] font-bold text-slate-900">{st.queued}</div>
          queued · <span className="font-semibold text-primary-700">view</span>
        </button>
        <button type="button" onClick={() => setList('FAILED')} className="rounded-lg bg-slate-50 p-2 transition hover:bg-primary-50 hover:ring-1 hover:ring-primary/30" title="See failed messages and send them again">
          <div className={st.failed7d ? 'text-[18px] font-bold text-[#B91C1C]' : 'text-[18px] font-bold text-slate-900'}>{st.failed7d}</div>
          failed · 7 d · <span className="font-semibold text-primary-700">view</span>
        </button>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="text-[13px] font-bold text-slate-900">{st.lastSentAt ? ago(st.lastSentAt) : '—'}</div>
          last sent
        </div>
      </div>
      {list && <WaQueueDrawer status={list} onClose={() => setList(null)} onChanged={() => (refresh(), router.refresh())} />}
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
