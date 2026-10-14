'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Save } from 'lucide-react'
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
          <label className="block"><span className="hc-label">OAuth refresh token</span><input type="password" className="hc-input" required={!gmail.oauth2.hasRefreshToken} value={refreshToken} onChange={(e) => setRefreshToken(e.target.value)} autoComplete="new-password" placeholder={gmail.oauth2.hasRefreshToken ? 'Saved — leave blank to keep' : 'Refresh token for the sending account'} disabled={busy} /></label>
          <details className="text-xs leading-5 text-slate-600">
            <summary className="cursor-pointer font-semibold text-primary">How to obtain OAuth credentials</summary>
            <ol className="mt-2 list-decimal space-y-2 pl-4">
              <li>Enable Gmail API in your Google Cloud project and configure the OAuth consent screen.</li>
              <li>Create a Web application OAuth client. For OAuth Playground setup, add <code className="break-all">https://developers.google.com/oauthplayground</code> as an authorized redirect URI.</li>
              <li>Open <a className="text-primary underline" href="https://developers.google.com/oauthplayground/" target="_blank" rel="noreferrer">Google OAuth Playground</a>. In its settings, enable “Use your own OAuth credentials” and enter this client ID and secret.</li>
              <li>Authorize <code className="break-all">https://www.googleapis.com/auth/gmail.send</code> with the sending account, exchange the authorization code, and copy the refresh token here.</li>
            </ol>
            <p className="mt-2">A consent screen in Testing may issue refresh tokens that expire after seven days. Follow <a href="https://developers.google.com/identity/protocols/oauth2/web-server#offline" target="_blank" rel="noreferrer" className="text-primary underline">Google’s production authorization guidance</a> for ongoing delivery.</p>
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
