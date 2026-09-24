'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { api } from '@/components/client/api'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

export function LoginForm({ client }: { client: 'web' | 'app' }) {
  const next = useSearchParams().get('next')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<{ code?: string; message: string } | null>(null)
  const big = client === 'app'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const r = await api<{ redirect: string }>('/auth/login', { body: { identifier, password, client, remember } })
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null
      window.location.href = safeNext && (client === 'app' ? safeNext.startsWith('/m') : !safeNext.startsWith('/m')) ? safeNext : r.redirect
    } catch (e: any) {
      setErr({ code: e.code, message: e.message })
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {err && (
        <div className="flex items-start gap-2 rounded-lg bg-[#FEE2E2] px-3.5 py-3 text-[13px] text-[#B91C1C]">
          <AlertTriangle size={16} className="mt-px flex-none" />
          <div>
            {err.code === 'PLATFORM_DENIED' ? <b>{client === 'web' ? 'This account is app-only.' : 'This account is web-only.'} </b> : null}
            {err.code === 'PLATFORM_DENIED' ? err.message.replace(/^This account is (app|web)-only\.\s*/, '') : err.message}
            {err.code === 'PLATFORM_DENIED' && client === 'web' && (
              <a href="/m/login" className="mt-1 block font-semibold underline">
                Open the field app →
              </a>
            )}
          </div>
        </div>
      )}
      <label>
        <span className={cx('hc-label', big && 'text-[13px]')}>Employee ID, phone or email</span>
        <input className={cx('hc-input', big && 'hc-input-lg')} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" placeholder="e.g. 11432 or 01711-234567" required autoFocus />
      </label>
      <label>
        <span className={cx('hc-label', big && 'text-[13px]')}>Password</span>
        <div className="relative">
          <input className={cx('hc-input pr-11', big && 'hc-input-lg')} type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400" aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </label>
      <div className="flex items-center justify-between text-[13px]">
        <label className="flex items-center gap-2 text-slate-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-primary" />
          {client === 'app' ? 'Remember this device' : 'Keep me signed in for 30 days'}
        </label>
        <a href={`mailto:?subject=${encodeURIComponent('Unico HomeCare password reset')}`} className="font-semibold text-primary" title="Ask your coordinator or IT to reset your password from Staff & users">
          Forgot password?
        </a>
      </div>
      <button type="submit" disabled={busy} className={btnClass('p', big ? 'xl' : 'md', 'mt-1 w-full')}>
        {busy && <Loader2 size={18} className="animate-spin" />}
        Sign in
      </button>
    </form>
  )
}
