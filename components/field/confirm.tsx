'use client'
// M12 Patient confirmation: Signature (canvas pad) / OTP (WhatsApp code) / Verbal, relation selector.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, MessageCircle } from 'lucide-react'
import { api, uploadFile, useToast, Segmented } from '@/components/client'
import { cx, time, mmss } from '@/lib/format'
import { BottomBar, CHeader, Body, bigBtn } from './bar'

type Mode = 'PAD' | 'OTP' | 'VERBAL'
const RELATIONS = ['Self', 'Spouse', 'Son', 'Daughter', 'Other'] as const
const REL_LABEL: Record<string, string> = { Self: 'Patient', Son: 'Son', Daughter: 'Daughter', Spouse: 'Spouse', Other: 'Other' }

// ---------------------------------------------------------------- signature pad
function SignaturePad({ onInk, padRef }: { onInk: (v: boolean) => void; padRef: React.MutableRefObject<{ clear: () => void; blob: () => Promise<Blob | null> } | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const inked = useRef(false)

  const setup = () => {
    const c = canvas.current!
    const r = c.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(r.width * dpr)
    c.height = Math.round(r.height * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, r.width, r.height)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0F172A'
    inked.current = false
    onInk(false)
  }
  useEffect(() => {
    setup()
    padRef.current = {
      clear: setup,
      blob: () => new Promise((res) => canvas.current!.toBlob((b) => res(b), 'image/png')),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  return (
    <canvas
      ref={canvas}
      className="absolute inset-0 size-full touch-none rounded-card"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drawing.current = true
        last.current = pos(e)
        const ctx = canvas.current!.getContext('2d')!
        ctx.beginPath()
        ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2)
        ctx.fillStyle = '#0F172A'
        ctx.fill()
      }}
      onPointerMove={(e) => {
        if (!drawing.current || !last.current) return
        const p = pos(e)
        const ctx = canvas.current!.getContext('2d')!
        ctx.beginPath()
        ctx.moveTo(last.current.x, last.current.y)
        ctx.lineTo(p.x, p.y)
        ctx.stroke()
        last.current = p
        if (!inked.current) {
          inked.current = true
          onInk(true)
        }
      }}
      onPointerUp={() => {
        drawing.current = false
        last.current = null
      }}
      onPointerCancel={() => {
        drawing.current = false
        last.current = null
      }}
    />
  )
}

// ---------------------------------------------------------------- screen
export function ConfirmScreen({
  id,
  requestNo,
  patient,
  guardian,
  existing,
  editable,
  nextHref,
  otpEnabled,
}: {
  id: string
  requestNo: string
  patient: string
  guardian?: { name?: string; relation?: string } | null
  existing?: { type?: string; at?: string; name?: string; relation?: string } | null
  editable: boolean
  nextHref: string
  otpEnabled: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [mode, setMode] = useState<Mode>('PAD')
  const guardRel = RELATIONS.find((r) => r.toLowerCase() === (guardian?.relation ?? '').toLowerCase())
  const [rel, setRel] = useState<string>('Self')
  const [name, setName] = useState(patient)
  const [ink, setInk] = useState(false)
  const pad = useRef<{ clear: () => void; blob: () => Promise<Blob | null> } | null>(null)
  const [verbal, setVerbal] = useState(false)
  const [otp, setOtp] = useState<{ to: string; expiresAt: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [sentAt, setSentAt] = useState(0)
  const [redo, setRedo] = useState(!existing?.at)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const pickRel = (r: string) => {
    setRel(r)
    if (r === 'Self') setName(patient)
    else if (r === guardRel && guardian?.name) setName(guardian.name)
    else if (name === patient) setName('')
  }

  async function done(msg: string) {
    toast(msg, 'ok')
    router.push(nextHref)
    router.refresh()
  }

  async function confirmPad() {
    const b = await pad.current?.blob()
    if (!b) throw new Error('Could not read the signature')
    const file = new File([b], `signature_${time(new Date()).replace(':', '')}.png`, { type: 'image/png' })
    const up = await uploadFile(file, { kind: 'SIGNATURE', requestId: id, caption: `${name} (${rel})` })
    await api(`/requests/${id}/confirmation`, { body: { type: 'PAD', attachmentId: up.id, relation: rel, name } })
    await done(`Confirmed by signature · ${time(new Date())}`)
  }

  async function sendCode() {
    setBusy(true)
    try {
      const r = await api<{ url: string; to: string; expiresAt: string }>(`/requests/${id}/otp`, { body: {} })
      window.open(r.url, '_blank')
      setOtp({ to: r.to, expiresAt: r.expiresAt })
      setSentAt(Date.now())
      setCode('')
      toast('WhatsApp opened with the code · tap Send', 'info')
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    setBusy(true)
    try {
      if (mode === 'PAD') await confirmPad()
      else if (mode === 'OTP') {
        await api(`/requests/${id}/otp`, { method: 'PUT', body: { code, relation: rel, name } })
        await done(`Confirmed by OTP · ${time(new Date())}`)
      } else {
        await api(`/requests/${id}/confirmation`, { body: { type: 'VERBAL', relation: rel, name } })
        await done(`Confirmed verbally · ${time(new Date())}`)
      }
    } catch (e: any) {
      toast(e.message, 'err')
      setBusy(false)
    }
  }

  const resendIn = Math.max(0, 60 - Math.floor((now - sentAt) / 1000))
  const expIn = otp ? Math.max(0, (new Date(otp.expiresAt).getTime() - now) / 1000) : 0
  const ready = !!name.trim() && (mode === 'PAD' ? ink : mode === 'OTP' ? /^\d{4}$/.test(code) && expIn > 0 : verbal)

  const TYPE: Record<string, string> = { PAD: 'signature', OTP: 'OTP', VERBAL: 'verbal confirmation' }
  if (existing?.at && !redo)
    return (
      <div className="min-w-0">
        <CHeader back={`/m/visits/${id}`} title="Patient confirmation" sub={`${patient} · ${requestNo}`} />
        <Body>
          <div className="flex items-start gap-3 rounded-card bg-[#DCFCE7] px-4 py-3.5 text-[#15803D]">
            <CheckCircle2 size={22} className="mt-0.5 flex-none" />
            <div>
              <div className="text-[15px] font-bold">
                Confirmed by {TYPE[existing.type ?? 'PAD']} · {time(existing.at)}
              </div>
              <div className="text-[13px]">
                {existing.name}
                {existing.relation ? ` (${REL_LABEL[existing.relation]?.toLowerCase() ?? existing.relation.toLowerCase()})` : ''}
              </div>
            </div>
          </div>
          {editable && (
            <button type="button" onClick={() => setRedo(true)} className="h-11 text-[14px] font-semibold text-primary-700">
              Record again
            </button>
          )}
        </Body>
        <BottomBar>
          <a href={nextHref} className={bigBtn('p')}>
            Continue
          </a>
        </BottomBar>
      </div>
    )

  return (
    <div className="min-w-0">
      <CHeader back={`/m/visits/${id}`} title="Patient confirmation" sub={`${patient} · ${requestNo}`} />
      <Body>
        <Segmented
          value={mode}
          onChange={setMode}
          items={[
            { value: 'PAD', label: 'Signature' },
            ...(otpEnabled ? [{ value: 'OTP' as Mode, label: 'OTP' }] : []),
            { value: 'VERBAL', label: 'Verbal' },
          ]}
        />
        <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">{mode === 'PAD' ? 'Who is signing?' : 'Who is confirming?'}</div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {RELATIONS.map((r) => (
            <button key={r} type="button" onClick={() => pickRel(r)} className={cx('h-8 flex-none rounded-full px-3 text-[13px] font-semibold', rel === r ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}>
              {REL_LABEL[r]}
            </button>
          ))}
        </div>
        <label>
          <span className="hc-label text-[13px]">Name</span>
          <input className="hc-input hc-input-lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </label>

        {mode === 'PAD' && (
          <>
            <div className="relative h-[220px] rounded-card border-[1.5px] border-dashed border-slate-300 bg-white shadow-card">
              <SignaturePad onInk={setInk} padRef={pad} />
              <div className="pointer-events-none absolute inset-x-4 bottom-10 h-px bg-slate-300" />
              <div className="pointer-events-none absolute bottom-3.5 left-4 text-[12px] text-slate-400">Sign above the line</div>
              <button type="button" onClick={() => pad.current?.clear()} className="absolute right-3 top-3 flex h-8 items-center rounded-lg bg-slate-100 px-3 text-[13px] font-semibold text-slate-700">
                Clear
              </button>
            </div>
            <div className="text-[12px] leading-[18px] text-slate-500">By signing, the patient or relative confirms the visit took place and the listed services were provided. Stored with time {time(now)}.</div>
          </>
        )}

        {mode === 'OTP' && (
          <div className="rounded-card bg-white p-4 shadow-card">
            {!otp ? (
              <>
                <div className="text-[15px] font-semibold">Send a 4-digit code to the patient</div>
                <div className="mt-1 text-[13px] text-slate-500">WhatsApp opens on your phone with the code ready for the patient&apos;s number. The patient reads it back to you.</div>
                <button type="button" disabled={busy} onClick={sendCode} className={cx(bigBtn('g'), 'mt-3 w-full')}>
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <MessageCircle size={18} />}
                  Send code on WhatsApp
                </button>
              </>
            ) : (
              <>
                <div className="text-[13px] text-slate-500">Code sent to {otp.to}</div>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={4}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="mt-3 h-16 w-full rounded-xl border-[1.5px] border-slate-300 text-center text-[32px] font-bold tracking-[.6em] outline-none focus:border-primary"
                  placeholder="••••"
                  aria-label="Confirmation code"
                />
                <div className="mt-2.5 flex items-center justify-between text-[13px]">
                  <span className={cx(expIn ? 'text-slate-500' : 'font-semibold text-[#B91C1C]')}>{expIn ? `Expires in ${mmss(expIn)}` : 'Code expired'}</span>
                  {resendIn ? (
                    <span className="text-slate-500">Resend in {mmss(resendIn)}</span>
                  ) : (
                    <button type="button" onClick={sendCode} disabled={busy} className="font-semibold text-primary-700">
                      Resend code
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {mode === 'VERBAL' && (
          <button type="button" onClick={() => setVerbal((v) => !v)} className="flex items-start gap-3 rounded-card bg-white p-4 text-left shadow-card">
            <span className={cx('mt-0.5 flex size-6 flex-none items-center justify-center rounded-md', verbal ? 'bg-primary text-white' : 'border-2 border-slate-300')}>{verbal && <CheckCircle2 size={16} />}</span>
            <span>
              <span className="block text-[15px] font-semibold">The {rel === 'Self' ? 'patient' : REL_LABEL[rel].toLowerCase()} confirmed the visit verbally</span>
              <span className="mt-0.5 block text-[13px] text-slate-500">Use only when a signature or OTP is not possible. Logged with your name and the time ({time(now)}).</span>
            </span>
          </button>
        )}
      </Body>
      <BottomBar>
        <button type="button" disabled={busy || !ready || !editable} onClick={submit} className={bigBtn(ready && editable ? 'p' : 'd')}>
          {busy && <Loader2 size={18} className="animate-spin" />}
          {mode === 'OTP' ? 'Verify & confirm visit' : 'Confirm visit'}
        </button>
      </BottomBar>
    </div>
  )
}
