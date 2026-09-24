'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, History, Loader2, RotateCcw, Send, Upload, X } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { EmailFrame, MsgStatus, PushCard, WaBubble } from '@/components/comms/MessageBits'
import { cx } from '@/lib/format'

type Tpl = {
  key: string
  name: string
  channel: string[]
  audience: string
  subject: string
  body: string
  isActive: boolean
  version: number
  customised: boolean
  updatedAt?: string
  updatedByName?: string
  defaultSubject: string
  defaultBody: string
}
type Hist = { version: number; subject: string; body: string; at: string | null; byName: string }
type Req = { id: string; requestNo: string; patientName: string }

const fDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', year: 'numeric' }) : '')
const CH: Record<string, string> = { EMAIL: 'Email', WHATSAPP: 'WhatsApp', PUSH: 'Push' }

export function TemplateEditor({ tpl, history, requests, placeholders, myEmail }: { tpl: Tpl; history: Hist[]; requests: Req[]; placeholders: readonly string[]; myEmail?: string }) {
  const router = useRouter()
  const toast = useToast()
  const [subject, setSubject] = useState(tpl.subject)
  const [bodyText, setBody] = useState(tpl.body)
  const [active, setActive] = useState(tpl.isActive)
  const [busy, setBusy] = useState<'' | 'publish' | 'test' | 'toggle'>('')
  const [showHistory, setShowHistory] = useState(false)
  const [requestId, setRequestId] = useState(requests[0]?.id ?? '')
  const [tab, setTab] = useState<string>(tpl.channel.includes('EMAIL') ? 'EMAIL' : tpl.channel[0] ?? 'EMAIL')
  const [preview, setPreview] = useState<{ subject: string; text: string; html: string; request: Req | null } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [testTo, setTestTo] = useState(myEmail ?? '')
  const [testLog, setTestLog] = useState<{ id: string; status: string; error?: string } | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const lastFocus = useRef<'subject' | 'body'>('body')

  // reset when switching template
  useEffect(() => {
    setSubject(tpl.subject)
    setBody(tpl.body)
    setTestLog(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl.key, tpl.version])
  useEffect(() => {
    setTab(tpl.channel.includes('EMAIL') ? 'EMAIL' : tpl.channel[0] ?? 'EMAIL')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl.key])
  useEffect(() => setActive(tpl.isActive), [tpl.isActive])

  const dirty = subject !== tpl.subject || bodyText !== tpl.body
  const unknown = useMemo(() => {
    const found = [...`${subject} ${bodyText}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    return [...new Set(found.filter((k) => !placeholders.includes(k)))]
  }, [subject, bodyText, placeholders])

  // live preview (debounced) with a real request
  useEffect(() => {
    let cancelled = false
    setPreviewing(true)
    const t = setTimeout(async () => {
      try {
        const r = await api(`/templates/${tpl.key}`, { body: { preview: true, requestId: requestId || undefined, subject, body: bodyText } })
        if (!cancelled) setPreview(r)
      } catch (e: any) {
        if (!cancelled) toast(e?.message ?? 'Preview failed', 'err')
      } finally {
        if (!cancelled) setPreviewing(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [tpl.key, requestId, subject, bodyText, toast])

  function insert(ph: string) {
    const token = `{${ph}}`
    if (lastFocus.current === 'subject' && subjectRef.current) {
      const el = subjectRef.current
      const s = el.selectionStart ?? subject.length
      const e = el.selectionEnd ?? s
      setSubject(subject.slice(0, s) + token + subject.slice(e))
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(s + token.length, s + token.length)
      })
      return
    }
    const el = bodyRef.current
    const s = el?.selectionStart ?? bodyText.length
    const e = el?.selectionEnd ?? s
    setBody(bodyText.slice(0, s) + token + bodyText.slice(e))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(s + token.length, s + token.length)
    })
  }

  async function publish() {
    setBusy('publish')
    try {
      const r = await api(`/templates/${tpl.key}`, { method: 'PUT', body: { subject, body: bodyText } })
      toast(`Published v${r.version}`, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e?.message ?? 'Could not publish', 'err')
    } finally {
      setBusy('')
    }
  }

  async function toggleActive(v: boolean) {
    setActive(v)
    setBusy('toggle')
    try {
      await api(`/templates/${tpl.key}`, { method: 'PUT', body: { isActive: v } })
      toast(v ? 'Template active — automatic sends resume' : 'Template paused — automatic sends are skipped', 'ok')
      router.refresh()
    } catch (e: any) {
      setActive(!v)
      toast(e?.message ?? 'Could not update', 'err')
    } finally {
      setBusy('')
    }
  }

  async function sendTest() {
    if (!testTo) return toast('Enter an email address for the test', 'err')
    setBusy('test')
    setTestLog(null)
    try {
      const r = await api<{ id: string }>(`/templates/${tpl.key}`, { body: { test: true, to: testTo, requestId: requestId || undefined, subject, body: bodyText } })
      setTestLog({ id: r.id, status: 'QUEUED' })
      // delivery runs after the response — poll the log briefly for the final status
      for (let i = 0; i < 6; i++) {
        await new Promise((res) => setTimeout(res, 1000))
        const m = await api<{ message: any }>(`/messages/${r.id}`).catch(() => null)
        if (m?.message) {
          setTestLog({ id: r.id, status: m.message.status, error: m.message.error })
          if (m.message.status !== 'QUEUED') break
        }
      }
    } catch (e: any) {
      toast(e?.message ?? 'Test send failed', 'err')
    } finally {
      setBusy('')
    }
  }

  const tabs = ['EMAIL', 'WHATSAPP', 'PUSH']

  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ------------------------------------------------ editor */}
      <div className="min-w-0 rounded-card bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-[200px] flex-1">
            <div className="font-mono text-[16px] font-bold">{tpl.key}</div>
            <div className="mt-0.5 text-[12px] leading-[18px] text-slate-500">
              {tpl.channel.map((c) => CH[c] ?? c).join(' + ')} · {tpl.audience} · v{tpl.version}
              {tpl.customised ? (tpl.updatedByName ? ` · edited by ${tpl.updatedByName} ${fDate(tpl.updatedAt)}` : ` · edited ${fDate(tpl.updatedAt)}`) : ' · default text'}
            </div>
          </div>
          <button type="button" onClick={() => setShowHistory((v) => !v)} className={btnClass(showHistory ? 'k' : 'o', 'md')}>
            <History size={16} /> History
          </button>
          <button type="button" onClick={publish} disabled={!dirty || !!busy} className={btnClass(dirty ? 'p' : 'd', 'md')}>
            {busy === 'publish' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Publish v{tpl.version + 1}
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 px-3.5 py-2.5">
          <div className="min-w-0 flex-1 text-[13px]">
            <div className="font-semibold">{active ? 'Active' : 'Paused'}</div>
            <div className="text-slate-500">{active ? 'Automatic sends use this template.' : 'Automatic sends of this template are skipped.'}</div>
          </div>
          <Toggle on={active} onChange={toggleActive} disabled={busy === 'toggle'} label="Template active" />
        </div>

        {showHistory && (
          <div className="mt-4 rounded-xl border border-slate-200">
            <div className="flex items-center border-b border-slate-100 px-3.5 py-2.5 text-[13px] font-bold">
              <span className="flex-1">Version history</span>
              <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-700" aria-label="Close history">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[260px] overflow-y-auto">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-primary-50/50 px-3.5 py-2.5 text-[13px]">
                <span className="w-9 font-mono font-bold">v{tpl.version}</span>
                <span className="min-w-0 flex-1 truncate">{tpl.customised ? `${tpl.updatedByName ?? 'Unknown'} · ${fDate(tpl.updatedAt)}` : 'Default text'}</span>
                <span className="text-[11px] font-bold uppercase text-primary-700">Live</span>
              </div>
              {history.map((h) => (
                <div key={h.version} className="flex items-center gap-3 border-b border-slate-100 px-3.5 py-2.5 text-[13px] last:border-0">
                  <span className="w-9 font-mono font-bold">v{h.version}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate" title={h.body}>{h.body.replace(/\s+/g, ' ').slice(0, 80)}</div>
                    <div className="text-[11.5px] text-slate-500">
                      {h.byName}
                      {h.at ? ` · ${fDate(h.at)}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={btnClass('o', 'sm')}
                    onClick={() => {
                      setSubject(h.subject ?? '')
                      setBody(h.body ?? '')
                      toast(`Loaded v${h.version} into the editor — Publish to make it live`, 'info')
                    }}
                  >
                    <RotateCcw size={14} /> Restore
                  </button>
                </div>
              ))}
              {!history.length && <div className="px-3.5 py-3 text-[13px] text-slate-400">No earlier versions yet. Publishing keeps the previous text here.</div>}
            </div>
          </div>
        )}

        <label className="hc-label mt-4">Subject {tpl.channel.includes('EMAIL') ? '(email subject · push title)' : '(push title)'}</label>
        <input ref={subjectRef} className="hc-input" value={subject} onFocus={() => (lastFocus.current = 'subject')} onChange={(e) => setSubject(e.target.value)} />

        <label className="hc-label mt-4">Body (WhatsApp text · email paragraphs · push body)</label>
        <textarea ref={bodyRef} className="hc-input min-h-[180px] font-[inherit]" rows={8} value={bodyText} onFocus={() => (lastFocus.current = 'body')} onChange={(e) => setBody(e.target.value)} />
        <div className="mt-1 text-[11.5px] text-slate-500">A blank line starts a new paragraph in email. {bodyText.length} characters.</div>

        {unknown.length > 0 && (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">
            <AlertTriangle size={15} className="mt-px flex-none" /> Unknown placeholder{unknown.length > 1 ? 's' : ''}: {unknown.map((u) => `{${u}}`).join(' ')} — will be sent as typed.
          </div>
        )}

        <div className="hc-label mt-4">Placeholders · click to insert at the cursor</div>
        <div className="flex flex-wrap gap-1.5">
          {placeholders.map((p) => (
            <button key={p} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p)} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11.5px] text-slate-700 hover:border-primary hover:bg-primary-50 hover:text-primary-700">
              {`{${p}}`}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {dirty && (
            <button type="button" className={btnClass('ghost', 'md')} onClick={() => (setSubject(tpl.subject), setBody(tpl.body))}>
              Discard changes
            </button>
          )}
          {tpl.customised && (tpl.defaultBody !== bodyText || tpl.defaultSubject !== subject) && tpl.defaultBody && (
            <button type="button" className={btnClass('ghost', 'md')} onClick={() => (setSubject(tpl.defaultSubject), setBody(tpl.defaultBody))}>
              <RotateCcw size={15} /> Load default text
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ preview */}
      <div className="min-w-0 rounded-card bg-white p-5 shadow-card xl:sticky xl:top-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 text-[15px] font-bold">
            Live preview {preview?.request ? `· ${preview.request.requestNo}` : ''}
            {previewing && <Loader2 size={14} className="ml-2 inline animate-spin text-slate-400" />}
          </div>
          <div className="flex gap-1.5">
            {tabs.map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={cx('h-8 rounded-lg px-3 text-[13px] font-semibold', tab === t ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700', !tpl.channel.includes(t) && tab !== t && 'opacity-60')}>
                {CH[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[13px]">
          <span className="text-slate-500">Data from</span>
          <select className="hc-input h-9 flex-1" value={requestId} onChange={(e) => setRequestId(e.target.value)}>
            {requests.map((r) => (
              <option key={r.id} value={r.id}>
                {r.requestNo} · {r.patientName}
              </option>
            ))}
            {!requests.length && <option value="">No requests yet</option>}
          </select>
        </div>
        {!tpl.channel.includes(tab) && <div className="mt-2 text-[12px] text-slate-500">This template is not sent on {CH[tab]} automatically — preview only.</div>}
        <div className="mt-3">
          {!preview ? (
            <div className="flex h-[300px] items-center justify-center text-slate-400">
              <Loader2 className="animate-spin" />
            </div>
          ) : tab === 'EMAIL' ? (
            <>
              <div className="mb-2 truncate rounded-lg bg-slate-50 px-3 py-2 text-[13px]">
                <span className="text-slate-500">Subject: </span>
                <b>{preview.subject}</b>
              </div>
              <EmailFrame html={preview.html} height={470} />
            </>
          ) : tab === 'WHATSAPP' ? (
            <WaBubble text={preview.text} at="now" ticks={false} />
          ) : (
            <PushCard title={preview.subject} body={preview.text} />
          )}
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="hc-label">Send a test email (rendered with this request’s data)</div>
          <div className="flex gap-2">
            <input className="hc-input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@unicohospitals.com" />
            <button type="button" onClick={sendTest} disabled={busy === 'test'} className={btnClass('o', 'md')}>
              {busy === 'test' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send test
            </button>
          </div>
          {testLog && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-slate-600">
              <MsgStatus status={testLog.status} />
              {testLog.status === 'SKIPPED' ? 'Gmail is not configured, so the test was logged but not sent.' : testLog.status === 'FAILED' ? testLog.error : testLog.status === 'QUEUED' ? 'Still sending…' : 'Sent.'}
              <Link href={`/messages?channel=EMAIL&id=${testLog.id}`} className="font-semibold text-primary-700 underline">
                Open in Messages log
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
