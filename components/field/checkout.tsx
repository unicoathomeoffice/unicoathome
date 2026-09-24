'use client'
// M13 (1h) + S6 (5h): summary before the irreversible step, bill + paid/due, transport used, remarks → Check-out & complete.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Camera, Check, CheckCircle2, ChevronRight, ClipboardCheck, FileText, HeartPulse, Loader2, PenLine, Repeat2 } from 'lucide-react'
import { api, stamp, useToast, Segmented, Toggle, WhatsAppButton } from '@/components/client'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, TRANSPORT_MODES, TRANSPORT_MODE_LABEL } from '@/lib/constants'
import { cx, time, taka, dur } from '@/lib/format'
import { BottomBar, CHeader, Body, bigBtn } from './bar'
import { Radio } from './visit'

type Pay = (typeof PAYMENT_METHODS)[number]
type Mode = (typeof TRANSPORT_MODES)[number]

export type CheckoutProps = {
  id: string
  requestNo: string
  patient: string
  patientId: string
  status: string
  checkInAt?: string
  checkOutAt?: string
  plannedMin: number
  lateMin?: number | null
  overtimePct: number
  ck: { done: number; total: number; mand: number; last?: string; missing: { key: string; label: string }[] }
  vitals: { at?: string; parts: { label: string; value: string; bad?: boolean }[] }
  photos: number
  meds: number
  notes: boolean
  confirmation?: { type?: string; at?: string; name?: string; relation?: string } | null
  estimatedFee?: number | null
  billing: { billAmount?: number; status?: string; method?: string }
  transport: { mode?: Mode; label?: string }
  remarks: string
  canFollowUp: boolean
  durationMin?: number | null
}

export function CheckoutScreen(p: CheckoutProps) {
  const router = useRouter()
  const toast = useToast()
  const [now, setNow] = useState(() => Date.now())
  const [amount, setAmount] = useState(p.billing.billAmount != null ? String(p.billing.billAmount) : p.estimatedFee != null ? String(p.estimatedFee) : '')
  const [status, setStatus] = useState<'PAID' | 'DUE' | ''>((p.billing.status as 'PAID') ?? '')
  const [method, setMethod] = useState<Pay>((p.billing.method as Pay) ?? 'CASH')
  const [asPlanned, setAsPlanned] = useState(!!p.transport.mode)
  const [mode, setMode] = useState<Mode | ''>(p.transport.mode ?? '')
  const [remarks, setRemarks] = useState(p.remarks)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ at: string; min: number } | null>(p.status === 'COMPLETED' || p.status === 'CLOSED' ? { at: p.checkOutAt ?? '', min: p.durationMin ?? 0 } : null)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  const min = p.checkInAt ? Math.max(0, Math.round((now - new Date(p.checkInAt).getTime()) / 60000)) : 0
  const within = min <= p.plannedMin * (1 + p.overtimePct / 100)
  const blocked = p.ck.missing.length > 0
  const ready = !blocked && amount !== '' && !!status && p.status === 'IN_PROGRESS'

  async function submit() {
    setBusy(true)
    try {
      await api(`/requests/${p.id}/check-out`, {
        body: {
          ...stamp(),
          billAmount: Number(amount),
          billingStatus: status,
          paymentMethod: status === 'PAID' ? method : undefined,
          transportMode: (asPlanned ? p.transport.mode : mode) || undefined,
          remarks: remarks || undefined,
        },
      })
      setDone({ at: new Date().toISOString(), min })
      toast(`Visit completed · ${time(new Date())}`, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e?.message === 'Failed to fetch' ? 'No connection · check-out needs the network, try again' : e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  if (done)
    return (
      <div className="min-w-0">
        <CHeader back={`/m/visits/${p.id}`} title="Visit complete" sub={`${p.requestNo} · ${p.patient}`} />
        <Body className="pt-8">
          <div className="flex flex-col items-center text-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-[#DCFCE7] text-[#16A34A]">
              <CheckCircle2 size={44} />
            </div>
            <div className="mt-4 text-[22px] font-bold">Visit completed</div>
            <div className="mt-1 text-[15px] text-slate-500">
              Checked out {time(done.at)} · {dur(done.min)}
            </div>
            <div className="mt-2 max-w-[300px] text-[13px] text-slate-500">The visit report goes to Family Medicine and the coordinator. Send the patient a thank-you with the feedback link.</div>
          </div>
          <div className="mt-4 grid gap-2.5">
            <WhatsAppButton requestId={p.id} templateKey="patient_completed" kind="g" size="xl" className="w-full">
              Send thank-you WhatsApp
            </WhatsAppButton>
            {p.canFollowUp && (
              <Link href={`/m/new-request?patientId=${p.patientId}&from=${p.id}`} className={cx(bigBtn('o'), 'w-full flex-none')}>
                <Repeat2 size={18} /> Request follow-up
              </Link>
            )}
          </div>
        </Body>
        <BottomBar>
          <Link href="/m" className={bigBtn('p')}>
            Back to today
          </Link>
        </BottomBar>
      </div>
    )

  const TYPE: Record<string, string> = { PAD: 'signature', OTP: 'OTP', VERBAL: 'verbal confirmation' }
  const rows = [
    {
      href: 'checklist',
      icon: blocked ? AlertTriangle : ClipboardCheck,
      tone: blocked ? 'r' : 'g',
      title: `Checklist ${p.ck.done}/${p.ck.total}`,
      sub: blocked ? `${p.ck.missing.length} mandatory item${p.ck.missing.length === 1 ? '' : 's'} missing` : `${p.ck.mand} mandatory · ${p.ck.total - p.ck.mand} optional${p.ck.last ? ` · last tick ${time(p.ck.last)}` : ''}`,
    },
    {
      href: 'vitals',
      icon: HeartPulse,
      tone: !p.vitals.at ? 's' : p.vitals.parts.some((x) => x.bad) ? 'a' : 'g',
      title: p.vitals.at ? `Vitals · ${time(p.vitals.at)}` : 'Vitals · not recorded',
      sub: p.vitals.at ? (
        <>
          {p.vitals.parts.map((x, i) => (
            <span key={x.label}>
              {i ? ' · ' : ''}
              {x.label} <span className={cx(x.bad && 'font-bold text-[#B45309]')}>{x.value}</span>
            </span>
          ))}
        </>
      ) : (
        'Optional unless on the checklist'
      ),
    },
    {
      href: 'photos',
      icon: Camera,
      tone: p.photos || p.meds ? 'b' : 's',
      title: `${p.photos} photo${p.photos === 1 ? '' : 's'} · ${p.meds} medication${p.meds === 1 ? '' : 's'}`,
      sub: p.notes ? 'Notes saved' : 'No notes yet',
    },
    {
      href: 'confirm',
      icon: PenLine,
      tone: p.confirmation?.at ? 'g' : 'a',
      title: p.confirmation?.at ? `Confirmed by ${TYPE[p.confirmation.type ?? 'PAD']} · ${time(p.confirmation.at)}` : 'Patient confirmation missing',
      sub: p.confirmation?.at ? `${p.confirmation.name ?? ''}${p.confirmation.relation ? ` (${p.confirmation.relation === 'Self' ? 'patient' : p.confirmation.relation.toLowerCase()})` : ''}` : 'Get a signature, OTP or verbal confirmation',
    },
  ]
  const TONE: Record<string, string> = { g: 'bg-[#DCFCE7] text-[#15803D]', a: 'bg-[#FEF3C7] text-[#B45309]', r: 'bg-[#FEE2E2] text-[#B91C1C]', b: 'bg-primary-50 text-primary-700', s: 'bg-slate-100 text-slate-500' }

  return (
    <div className="min-w-0">
      <CHeader back={`/m/visits/${p.id}`} title="Check-out & complete" sub={`${p.requestNo} · ${p.patient}`} />
      <Body>
        <div className="rounded-card bg-white p-4 shadow-card">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-slate-500">Check-in</div>
              <div className="mt-0.5 text-[22px] font-bold">{time(p.checkInAt)}</div>
            </div>
            <div className="border-x border-slate-100">
              <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-slate-500">Check-out</div>
              <div className="mt-0.5 text-[22px] font-bold" suppressHydrationWarning>{time(now)}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-slate-500">Duration</div>
              <div className={cx('mt-0.5 text-[22px] font-bold', within ? 'text-[#15803D]' : 'text-[#B45309]')}>
                {min}
                <span className="text-[13px] font-semibold text-slate-500"> min</span>
              </div>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className={cx('h-full rounded-full', within ? 'bg-[#16A34A]' : 'bg-[#F59E0B]')} style={{ width: `${Math.min(100, (min / p.plannedMin) * 100)}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[12px] text-slate-500">
            <span>
              Planned {p.plannedMin} min{p.lateMin != null ? ` · ${p.lateMin > 10 ? `${p.lateMin} min late start` : 'on time'}` : ''}
            </span>
            <span className={cx(!within && 'font-semibold text-[#B45309]')}>{within ? `Within +${p.overtimePct}%` : `Overtime +${min - p.plannedMin} min`}</span>
          </div>
        </div>

        <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
          {rows.map((r) => (
            <Link key={r.href} href={`/m/visits/${p.id}/${r.href}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-slate-50">
              <span className={cx('flex size-8 flex-none items-center justify-center rounded-lg', TONE[r.tone])}>
                <r.icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{r.title}</span>
                <span className="block text-[12px] text-slate-500">{r.sub}</span>
              </span>
              <ChevronRight size={18} className="flex-none text-slate-400" />
            </Link>
          ))}
        </div>

        {blocked && (
          <div className="rounded-card border-[1.5px] border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3">
            <div className="flex items-center gap-2 text-[14px] font-bold text-[#B91C1C]">
              <AlertTriangle size={16} /> Tick these before completing
            </div>
            <div className="mt-1.5 grid">
              {p.ck.missing.map((m) => (
                <Link key={m.key} href={`/m/visits/${p.id}/checklist`} className="flex min-h-10 items-center justify-between text-[14px] text-[#991B1B]">
                  <span>• {m.label}</span>
                  <ChevronRight size={16} />
                </Link>
              ))}
            </div>
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">
            Total amount of the patient&apos;s bill <span className="text-[#DC2626]">*</span>
          </span>
          <span className="flex h-14 items-center gap-1.5 rounded-lg border-[1.5px] border-slate-300 bg-white px-3.5 focus-within:border-primary">
            <span className="text-[22px] font-bold text-slate-500">৳</span>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 7))} className="h-full min-w-0 flex-1 bg-transparent text-[22px] font-bold outline-none" aria-label="Total bill amount" />
          </span>
          <span className="mt-1.5 block text-[12px] text-slate-500">{p.estimatedFee != null ? `Estimated at confirmation: ${taka(p.estimatedFee)} · numbers only` : 'Numbers only'}</span>
        </label>

        <div>
          <div className="mb-1.5 text-[13px] font-semibold text-slate-700">
            Patient billing status <span className="text-[#DC2626]">*</span>
          </div>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white px-4 shadow-card">
            <Radio on={status === 'PAID'} label="Paid" onClick={() => setStatus('PAID')} className="min-h-12" />
            <Radio on={status === 'DUE'} label="Payment due" onClick={() => setStatus('DUE')} className="min-h-12" />
          </div>
        </div>

        {status === 'PAID' && (
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-slate-700">Collected as</div>
            <Segmented h={40} value={method} onChange={setMethod} items={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
          </div>
        )}

        <div className="rounded-card bg-white px-3.5 py-3 shadow-card">
          {p.transport.mode ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[15px] font-semibold">Transport used as planned</div>
                <div className="text-[12px] text-slate-500">{p.transport.label} · change if you used Rickshaw / Uber / Pathao</div>
              </div>
              <Toggle on={asPlanned} onChange={setAsPlanned} label="Transport used as planned" />
            </div>
          ) : (
            <div className="text-[15px] font-semibold">How did you travel? <span className="text-[12px] font-normal text-slate-500">optional</span></div>
          )}
          {!asPlanned && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {TRANSPORT_MODES.map((m) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={cx('h-9 rounded-full px-3.5 text-[13px] font-semibold', mode === m ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}>
                  {TRANSPORT_MODE_LABEL[m]}
                </button>
              ))}
            </div>
          )}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">Special instructions / notes</span>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Patient stable. Next visit Fri, same slot." className="hc-input min-h-[64px] border-[1.5px] text-[15px]" />
        </label>

        <div className="flex gap-2.5 rounded-card bg-slate-200/60 px-3.5 py-3 text-[12px] leading-[18px] text-slate-500">
          <FileText size={16} className="mt-px flex-none" />
          <div>Invoice number, invoice total and print status are added by the front desk when the invoice is issued.</div>
        </div>
      </Body>
      <BottomBar
        note={blocked ? `${p.ck.missing.length} mandatory item${p.ck.missing.length === 1 ? '' : 's'} left · complete unlocks after the checklist` : !status ? 'Choose Paid or Payment due' : undefined}
        sub={!blocked ? 'Sends the report to Family Medicine and a thank-you to the patient' : undefined}
      >
        <button type="button" disabled={busy || !ready} onClick={submit} className={bigBtn(ready ? 'g' : 'd')}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={20} strokeWidth={3} />}
          Check-out &amp; complete
        </button>
      </BottomBar>
    </div>
  )
}
