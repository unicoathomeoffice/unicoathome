'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Copy, Loader2, Save } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import type { GmailMode, GmailStatus } from '@/lib/gmail-types'

export function GmailConnection({ gmail, onSaved }: { gmail: GmailStatus; onSaved: (status: GmailStatus) => void }) {
  const router = useRouter()
  const toast = useToast()
  const [mode, setMode] = useState<GmailMode>(gmail.mode)
  const [smtpUser, setSmtpUser] = useState(gmail.smtp.user)
  const [oauthUser, setOauthUser] = useState(gmail.oauth2.user)
  const [password, setPassword] = useState('')
  const [clientId, setClientId] = useState(gmail.oauth2.clientId)
  const [clientSecret, setClientSecret] = useState('')
  const [refreshToken, setRefreshToken] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = mode !== gmail.mode || (mode === 'smtp'
    ? smtpUser !== gmail.smtp.user || !!password
    : oauthUser !== gmail.oauth2.user || clientId !== gmail.oauth2.clientId || !!clientSecret || !!refreshToken)

  const params = useSearchParams()
  const [redirectUri, setRedirectUri] = useState('/api/v1/settings/gmail/oauth')
  useEffect(() => setRedirectUri(`${window.location.origin}/api/v1/settings/gmail/oauth`), [])

  // result of the Google round trip: /settings?gmail=connected:<email> or ?gmail=error:<message>
  useEffect(() => {
    const r = params.get('gmail')
    if (!r) return
    if (r.startsWith('connected:')) toast(`Gmail connected as ${r.slice(10)}. Send a test email to verify delivery.`, 'ok')
    else toast(r.replace(/^error:/, ''), 'err')
    router.replace('/settings', { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  /** Start Google's consent screen; the server finishes the connection on the way back. */
  async function connect() {
    setBusy(true)
    try {
      const { url } = await api<{ url: string }>('/settings/gmail/oauth', { method: 'POST', body: { clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined } })
      window.location.href = url
    } catch (e: any) {
      toast(e.message ?? 'Could not start Google sign-in', 'err')
      setBusy(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const payload = mode === 'smtp' ? { mode, user: smtpUser, appPassword: password } : { mode, user: oauthUser, clientId, clientSecret, refreshToken }
      const result = await api<{ gmail: GmailStatus }>('/settings/gmail', { method: 'PATCH', body: payload })
      onSaved(result.gmail)
      setPassword(''); setClientSecret(''); setRefreshToken('')
      toast('Gmail configuration saved. Send a test email to verify delivery.', 'ok')
      router.refresh()
    } catch (e: any) { toast(e.message ?? 'Could not save Gmail configuration', 'err') }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={save} className="space-y-3 border-b border-slate-100 pb-4">
      <div role="tablist" aria-label="Gmail delivery method" className="flex gap-1 rounded-lg bg-slate-200 p-1 text-xs font-semibold">
        {([{ key: 'smtp', label: 'A · SMTP + App Password' }, { key: 'oauth2', label: 'B · Gmail API OAuth2' }] as const).map((tab) => (
          <button key={tab.key} id={`gmail-tab-${tab.key}`} role="tab" aria-selected={mode === tab.key} aria-controls="gmail-connection-panel" type="button" disabled={busy} onClick={() => setMode(tab.key)} className={cx('min-h-10 flex-1 rounded-md px-2', mode === tab.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white/60')}>{tab.label}</button>
        ))}
      </div>
      <p className="text-xs text-slate-500">Active method: {gmail.mode === 'smtp' ? 'SMTP' : 'Gmail API OAuth2'}. Saving activates the selected method.</p>
      <div id="gmail-connection-panel" role="tabpanel" aria-labelledby={`gmail-tab-${mode}`} className="space-y-3">
        <label className="block">
          <span className="hc-label">Sending account</span>
          <input required type="email" className="hc-input" autoComplete="off" value={mode === 'smtp' ? smtpUser : oauthUser} onChange={(e) => mode === 'smtp' ? setSmtpUser(e.target.value) : setOauthUser(e.target.value)} placeholder="department@gmail.com" disabled={busy} />
        </label>
        {mode === 'smtp' ? <>
          <label className="block">
            <span className="hc-label">Google App Password</span>
            <input type="password" className="hc-input" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={gmail.smtp.hasPassword ? 'Saved — leave blank to keep' : '16-letter App Password'} required={!gmail.smtp.hasPassword} disabled={busy} />
          </label>
          <p className="text-xs leading-5 text-slate-500">Enable 2-Step Verification, then create an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="text-primary underline">App Password in your Google account</a>. Use that password here.</p>
        </> : <>
          <label className="block"><span className="hc-label">OAuth client ID</span><input className="hc-input" required value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" placeholder="…apps.googleusercontent.com" disabled={busy} /></label>
          <label className="block"><span className="hc-label">OAuth client secret</span><input type="password" className="hc-input" required={!gmail.oauth2.hasClientSecret} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" placeholder={gmail.oauth2.hasClientSecret ? 'Saved — leave blank to keep' : 'Client secret'} disabled={busy} /></label>
          <div className="rounded-[10px] border border-slate-200 bg-slate-50 p-3">
            <button type="button" onClick={connect} disabled={busy || !clientId.trim() || (!clientSecret && !gmail.oauth2.hasClientSecret)} className={cx(btnClass('o', 'md'), 'w-full bg-white')}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <GoogleG />} {gmail.oauth2.hasRefreshToken ? 'Reconnect with Google' : 'Connect with Google'}
            </button>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Sign in as the sending account and allow “Send email on your behalf”. You come straight back here, connected. The OAuth client must list this redirect URI:
            </p>
            <button type="button" onClick={() => navigator.clipboard?.writeText(redirectUri).then(() => toast('Redirect URI copied', 'ok'))} className="mt-1 flex w-full items-center gap-2 rounded-md bg-white px-2 py-1.5 text-left font-mono text-[11px] text-slate-700 ring-1 ring-slate-200 hover:ring-primary" title="Copy">
              <span className="min-w-0 flex-1 break-all">{redirectUri}</span> <Copy size={13} className="flex-none text-slate-400" />
            </button>
          </div>
          <details className="text-xs leading-5 text-slate-600">
            <summary className="cursor-pointer font-semibold text-primary">Paste a refresh token instead</summary>
            <label className="mt-2 block"><span className="hc-label">OAuth refresh token</span><input type="password" className="hc-input" value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} autoComplete="new-password" placeholder={gmail.oauth2.hasRefreshToken ? 'Saved — leave blank to keep' : 'Refresh token for the sending account'} disabled={busy} /></label>
            <p className="mt-1">Get one from <a className="text-primary underline" href="https://developers.google.com/oauthplayground/" target="_blank" rel="noreferrer">Google OAuth Playground</a> with your own client ID/secret and the <code className="break-all">https://www.googleapis.com/auth/gmail.send</code> scope, then press Save.</p>
          </details>
        </>}
      </div>
      <p className="text-xs text-slate-500">Credentials are encrypted. Saved passwords and tokens are never displayed.</p>
      {!gmail.canSave && <p role="alert" className="text-xs text-red-700">Server encryption must be configured before credentials can be saved.</p>}
      <button type="submit" className={btnClass('p', 'md')} disabled={busy || !dirty || !gmail.canSave}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save & use {mode === 'smtp' ? 'SMTP' : 'OAuth2'}
      </button>
    </form>
  )
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}
