'use client'
// Settings → Integrations → H360 (hospital HIS). Super admin saves the login HomeCare uses to read H360 (patient search,
// later bills and prices). Stored encrypted on the server; the password is never shown again.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, PlugZap, Save, Trash2, XCircle } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'

type Status = { configured: boolean; savedAt: string | null; ok?: boolean; at?: string; error?: string | null; username: string | null; baseUrl: string }

export function H360Card({ initial }: { initial: Status }) {
  const router = useRouter()
  const toast = useToast()
  const [v, setV] = useState({ baseUrl: initial.baseUrl, username: initial.username ?? '', password: '' })
  const [sample, setSample] = useState('')
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'remove'>(null)
  const [result, setResult] = useState<null | { ok: boolean; error?: string; found?: number | null; first?: string | null; endpoint?: string }>(null)
  const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')

  async function save() {
    setBusy('save')
    try {
      await api('/integrations/h360', { body: { baseUrl: v.baseUrl.trim(), username: v.username.trim(), password: v.password || undefined } })
      toast('H360 login saved', 'ok')
      setV((x) => ({ ...x, password: '' }))
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  async function test() {
    setBusy('test')
    setResult(null)
    try {
      const r = await api<typeof result>('/integrations/h360', { body: { test: true, sample: sample.trim() || undefined } })
      setResult(r)
      router.refresh()
    } catch (e: any) {
      setResult({ ok: false, error: e.message })
    } finally {
      setBusy(null)
    }
  }
  async function remove() {
    if (!confirm('Remove the saved H360 login? Live H360 search stops working.')) return
    setBusy('remove')
    try {
      await api('/integrations/h360', { method: 'DELETE' })
      toast('H360 login removed', 'ok')
      setV({ baseUrl: initial.baseUrl, username: '', password: '' })
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col rounded-card bg-white p-5 shadow-card">
      <div className="mb-1 flex items-center gap-2">
        <PlugZap size={18} className="text-primary-700" />
        <h2 className="text-base font-bold">H360 hospital system</h2>
        {initial.configured && (initial.ok ? <span className="ml-auto rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11.5px] font-bold text-[#15803D]">Connected</span> : initial.ok === false ? <span className="ml-auto rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[11.5px] font-bold text-[#B91C1C]">Login failed</span> : null)}
      </div>
      <p className="text-[13px] text-slate-500">HomeCare signs in to H360 with this account to search patients live by UHID, mobile or name (read-only). Use a separate H360 user for HomeCare, not a personal login.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="hc-label">H360 address</span>
          <input className="hc-input" value={v.baseUrl} onChange={(e) => setV({ ...v, baseUrl: e.target.value })} placeholder="http://115.127.139.2:8085" />
          {/^http:\/\//.test(v.baseUrl) && <span className="mt-1 block text-[12px] text-[#B45309]">http:// is not encrypted between HomeCare and H360 — use https:// if H360 offers it.</span>}
        </label>
        <label>
          <span className="hc-label">User name</span>
          <input className="hc-input" autoComplete="off" value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} />
        </label>
        <label>
          <span className="hc-label">Password</span>
          <input className="hc-input" type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} placeholder={initial.configured ? '•••••••• (saved — leave empty to keep)' : ''} />
        </label>
      </div>
      {initial.configured && (
        <div className="mt-2 text-[12px] text-slate-500">
          Saved {when(initial.savedAt)}
          {initial.at ? ` · last check ${when(initial.at)}${initial.ok ? ' OK' : initial.error ? ` — ${initial.error}` : ''}` : ''}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <button type="button" className={btnClass('p', 'md')} disabled={!!busy || !v.username.trim() || (!initial.configured && !v.password)} onClick={save}>
          {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save login
        </button>
        {initial.configured && (
          <>
            <input className="hc-input h-10 w-[200px]" value={sample} onChange={(e) => setSample(e.target.value)} placeholder="Test search (UHID / mobile)" />
            <button type="button" className={btnClass('o', 'md')} disabled={!!busy} onClick={test}>
              {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />} Test connection
            </button>
            <button type="button" className={btnClass('ghost', 'md', 'text-[#B91C1C]')} disabled={!!busy} onClick={remove}>
              <Trash2 size={16} /> Remove
            </button>
          </>
        )}
      </div>
      {result && (
        <div className={`mt-3 rounded-lg px-3 py-2.5 text-[13px] ${result.ok ? 'bg-[#F0FDF4] text-[#15803D]' : 'bg-[#FEE2E2] text-[#B91C1C]'}`}>
          <div className="flex items-center gap-2 font-semibold">
            {result.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {result.ok ? 'Signed in to H360' : result.error}
          </div>
          {result.ok && (
            <div className="mt-1 text-[12px] text-slate-600">
              Live search via {result.endpoint ?? 'H360'}
              {result.found != null ? <> · test search found {result.found}{result.first ? ` — ${result.first}` : ''}</> : ' · type a UHID or mobile in the box to test a search'}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
