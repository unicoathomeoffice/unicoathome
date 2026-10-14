'use client'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { api } from '@/components/client/api'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import { useLang } from '@/components/public/i18n'
import { GoogleButton } from '@/components/GoogleButton'

const input = 'hc-input hc-input-lg !text-[16px]'
type Errors = Record<string, string>

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className={cx('block', error && '[&_.hc-input]:border-[#DC2626]')}>
      <span className="hc-label !text-[13.5px]">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[13px] font-medium text-[#B91C1C]">{error}</span> : hint && <span className="mt-1 block text-[12.5px] text-slate-500">{hint}</span>}
    </label>
  )
}

function PasswordInput({ value, onChange, autoComplete }: { value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input className={cx(input, 'pr-12')} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400" aria-label={show ? 'Hide' : 'Show'}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}

const ErrBox = ({ children }: { children: ReactNode }) => (
  <div role="alert" className="flex items-start gap-2 rounded-lg bg-[#FEE2E2] px-3.5 py-3 text-[14px] text-[#B91C1C]">
    <AlertTriangle size={18} className="mt-px flex-none" /> {children}
  </div>
)

function safeNext(next: string | null) {
  return next && next.startsWith('/my') ? next : '/my'
}

export function PatientLoginForm({ hotline }: { hotline: string }) {
  const { t } = useLang()
  const params = useSearchParams()
  const next = params.get('next')
  const [v, setV] = useState({ phone: '', password: '' })
  const [err, setErr] = useState(params.get('error') ?? '')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await api('/patient/login', { body: v })
      window.location.href = safeNext(next)
    } catch (e: any) {
      setErr(e.message)
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-[24px] font-bold leading-tight text-navy">{t.loginTitle}</h1>
        <p className="mt-1 text-[14.5px] text-slate-600">{t.loginSub}</p>
      </div>
      {err && <ErrBox>{err}</ErrBox>}
      <Field label={t.phone}>
        <input className={input} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} type="tel" inputMode="tel" autoComplete="username" placeholder="01XXXXXXXXX" required autoFocus />
      </Field>
      <Field label={t.password}>
        <PasswordInput value={v.password} onChange={(password) => setV({ ...v, password })} autoComplete="current-password" />
      </Field>
      <button type="submit" disabled={busy} className={btnClass('p', 'xl', 'w-full')}>
        {busy && <Loader2 size={18} className="animate-spin" />} {t.signIn}
      </button>
      <Or />
      <GoogleButton intent="patient" big label={t.googleContinue} />
      <p className="text-center text-[13px] text-slate-500">
        {t.noAccount}{' '}
        <Link href={`/my/register${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-primary-700">
          {t.createAccount}
        </Link>
      </p>
      <p className="text-center text-[12.5px] text-slate-400">
        {t.forgot}{' '}
        <a href={`tel:${hotline.replace(/[^\d+]/g, '')}`} className="font-semibold text-slate-600">
          {hotline}
        </a>
      </p>
    </form>
  )
}

export function PatientRegisterForm() {
  const { t } = useLang()
  const next = useSearchParams().get('next')
  const [v, setV] = useState({ name: '', phone: '', whatsapp: '', same: true, password: '', email: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await api('/patient/register', { body: { name: v.name, phone: v.phone, whatsapp: v.same ? v.phone : v.whatsapp, password: v.password, email: v.email || undefined } })
      window.location.href = safeNext(next)
    } catch (e: any) {
      if (e.fields) setErrors(e.fields)
      setErr(e.message)
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-[24px] font-bold leading-tight text-navy">{t.registerTitle}</h1>
        <p className="mt-1 text-[14.5px] text-slate-600">{t.registerSub}</p>
      </div>
      {err && <ErrBox>{err}</ErrBox>}
      <Field label={t.name} error={errors.name}>
        <input className={input} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoComplete="name" placeholder={t.namePh} required />
      </Field>
      <Field label={t.phone} error={errors.phone}>
        <input className={input} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" required />
      </Field>
      <div>
        <Field label={t.whatsapp} hint={t.whatsappHint} error={errors.whatsapp}>
          <input className={input} value={v.same ? v.phone : v.whatsapp} onChange={(e) => setV({ ...v, whatsapp: e.target.value, same: false })} type="tel" inputMode="tel" placeholder="01XXXXXXXXX" required />
        </Field>
        <label className="mt-1.5 flex items-center gap-2 text-[13px] text-slate-600">
          <input type="checkbox" className="size-4 accent-primary" checked={v.same} onChange={(e) => setV({ ...v, same: e.target.checked, whatsapp: e.target.checked ? '' : v.whatsapp })} /> {t.sameAsPhone}
        </label>
      </div>
      <Field label={t.email} error={errors.email}>
        <input className={input} value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} type="email" inputMode="email" autoComplete="email" placeholder="name@example.com" />
      </Field>
      <Field label={t.password} error={errors.password}>
        <PasswordInput value={v.password} onChange={(password) => setV({ ...v, password })} autoComplete="new-password" />
      </Field>
      <p className="text-[12.5px] leading-[19px] text-slate-500">{t.mandatoryNote}</p>
      <button type="submit" disabled={busy} className={btnClass('p', 'xl', 'w-full')}>
        {busy && <Loader2 size={18} className="animate-spin" />} {t.createAccount}
      </button>
      <Or />
      <GoogleButton intent="patient" big label={t.googleContinue} />
      <p className="text-center text-[13px] text-slate-500">
        {t.haveAccount}{' '}
        <Link href={`/my/login${next ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-primary-700">
          {t.signIn}
        </Link>
      </p>
    </form>
  )
}

function Or() {
  const { t } = useLang()
  return (
    <div className="flex items-center gap-3 text-[12px] font-semibold uppercase tracking-[.06em] text-slate-400">
      <span className="h-px flex-1 bg-slate-200" /> {t.or} <span className="h-px flex-1 bg-slate-200" />
    </div>
  )
}

/** Step 2 of "Continue with Google": mobile + WhatsApp (both required) for the new patient account. */
export function CompleteGoogleForm({ name, email, picture }: { name: string; email: string; picture?: string }) {
  const { t } = useLang()
  const [v, setV] = useState({ name, phone: '', whatsapp: '', same: true })
  const [errors, setErrors] = useState<Errors>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await api('/patient/register-google', { body: { name: v.name, phone: v.phone, whatsapp: v.same ? v.phone : v.whatsapp } })
      window.location.href = '/my'
    } catch (e: any) {
      if (e.fields) setErrors(e.fields)
      setErr(e.message)
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-[24px] font-bold leading-tight text-navy">{t.completeTitle}</h1>
        <p className="mt-1 text-[14.5px] text-slate-600">{t.completeSub}</p>
      </div>
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
        {picture ? <img src={picture} alt="" className="size-10 rounded-full" referrerPolicy="no-referrer" /> : null}
        <div className="min-w-0 text-[14px]">
          <div className="truncate font-semibold">{name}</div>
          <div className="truncate text-slate-500">{email}</div>
        </div>
      </div>
      {err && <ErrBox>{err}</ErrBox>}
      <Field label={t.name} error={errors.name}>
        <input className={input} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoComplete="name" required />
      </Field>
      <Field label={t.phone} error={errors.phone}>
        <input className={input} value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" required autoFocus />
      </Field>
      <div>
        <Field label={t.whatsapp} hint={t.whatsappHint} error={errors.whatsapp}>
          <input className={input} value={v.same ? v.phone : v.whatsapp} onChange={(e) => setV({ ...v, whatsapp: e.target.value, same: false })} type="tel" inputMode="tel" placeholder="01XXXXXXXXX" required />
        </Field>
        <label className="mt-1.5 flex items-center gap-2 text-[13px] text-slate-600">
          <input type="checkbox" className="size-4 accent-primary" checked={v.same} onChange={(e) => setV({ ...v, same: e.target.checked })} /> {t.sameAsPhone}
        </label>
      </div>
      <p className="text-[12.5px] leading-[19px] text-slate-500">{t.mandatoryNote}</p>
      <button type="submit" disabled={busy} className={btnClass('p', 'xl', 'w-full')}>
        {busy && <Loader2 size={18} className="animate-spin" />} {t.createAccount}
      </button>
    </form>
  )
}
