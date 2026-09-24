'use client'
// C1 (6d) Visit chat: staff ↔ coordinator thread, system events inline, quick replies, photo share, 10 s polling.
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, Loader2, Phone, Plus, SendHorizontal } from 'lucide-react'
import { api, uploadFile, useToast } from '@/components/client'
import { StatusChip, Avatar, telUrl } from '@/components/ui'
import { cx, time, relDay, isoDay } from '@/lib/format'
import { CHeader } from './bar'

type Msg = { id: string; kind: 'TEXT' | 'SYSTEM' | 'PHOTO'; text: string; attachmentId: string | null; at: string; mine: boolean; sender: { id: string; name: string; role: string } | null; pending?: boolean; failed?: boolean }
const QUICK = ['On my way', 'Running late', 'Patient not home', 'Need doctor advice']
const short = (n?: string) => {
  if (!n) return ''
  const p = n.replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(/\s+/)
  return p.length > 1 ? `${p[0]} ${p[1][0]}.` : p[0]
}

export function ChatScreen({
  id,
  initial,
  title,
  sub,
  callPhone,
  visit,
}: {
  id: string
  initial: Msg[]
  title: string
  sub: string
  callPhone?: string | null
  visit: { requestNo: string; patient: string; when: string; status: string }
}) {
  const toast = useToast()
  const [msgs, setMsgs] = useState<Msg[]>(initial)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const lastAt = useRef<string | undefined>(initial[initial.length - 1]?.at)
  const end = useRef<HTMLDivElement>(null)

  const scroll = (smooth = true) => end.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' })
  useEffect(() => {
    scroll(false)
  }, [])

  const poll = useCallback(async () => {
    if (document.visibilityState !== 'visible') return
    try {
      const r = await api<{ items: Msg[] }>(`/requests/${id}/chat${lastAt.current ? `?after=${encodeURIComponent(lastAt.current)}` : ''}`)
      if (r.items.length) {
        lastAt.current = r.items[r.items.length - 1].at
        setMsgs((xs) => {
          const known = new Set(xs.map((x) => x.id))
          const add = r.items.filter((m) => !known.has(m.id))
          return add.length ? [...xs, ...add] : xs
        })
        setTimeout(() => scroll(), 50)
      }
    } catch {}
  }, [id])
  useEffect(() => {
    const t = setInterval(poll, 10_000)
    return () => clearInterval(t)
  }, [poll])

  async function send(body: { text?: string; attachmentId?: string }, temp: Msg) {
    setMsgs((xs) => [...xs, temp])
    setTimeout(() => scroll(), 30)
    try {
      const r = await api<{ item: Msg }>(`/requests/${id}/chat`, { body })
      lastAt.current = r.item.at
      setMsgs((xs) => xs.map((x) => (x.id === temp.id ? r.item : x)))
    } catch (e: any) {
      setMsgs((xs) => xs.map((x) => (x.id === temp.id ? { ...x, pending: false, failed: true } : x)))
      toast(e.message, 'err')
    }
  }
  const sendText = (t: string) => {
    const v = t.trim()
    if (!v) return
    setText('')
    send({ text: v }, { id: `tmp_${Date.now()}`, kind: 'TEXT', text: v, attachmentId: null, at: new Date().toISOString(), mine: true, sender: null, pending: true })
  }
  async function sendPhoto(f: File) {
    setSending(true)
    try {
      const up = await uploadFile(f, { kind: 'PHOTO', requestId: id, caption: 'Chat photo' })
      await send({ attachmentId: up.id, text: text.trim() || undefined }, { id: `tmp_${Date.now()}`, kind: 'PHOTO', text: text.trim(), attachmentId: up.id, at: new Date().toISOString(), mine: true, sender: null, pending: true })
      setText('')
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setSending(false)
    }
  }

  let lastDay = ''
  return (
    <div className="flex min-h-dvh min-w-0 flex-col">
      <CHeader
        back={`/m/visits/${id}`}
        title={title}
        sub={sub}
        right={
          callPhone ? (
            <a href={telUrl(callPhone)} className="flex size-10 flex-none items-center justify-center rounded-lg border border-slate-200 text-primary-700" aria-label="Call">
              <Phone size={18} />
            </a>
          ) : null
        }
      />
      <div className="flex flex-1 flex-col gap-2.5 px-5 pb-[150px] pt-3">
        <Link href={`/m/visits/${id}`} className="flex items-center gap-2.5 rounded-card bg-white px-3 py-2.5 shadow-card">
          <Avatar name={visit.patient} size={32} />
          <div className="min-w-0 flex-1 text-[13px] leading-[18px]">
            <b>{visit.requestNo}</b> · {visit.patient} · {visit.when}
          </div>
          <StatusChip status={visit.status} sm />
        </Link>
        {!msgs.length && <div className="py-10 text-center text-[13px] text-slate-400">No messages yet. Ask the coordinator anything about this visit.</div>}
        {msgs.map((m) => {
          const d = isoDay(m.at)
          const sep = d !== lastDay ? (lastDay = d) : null
          return (
            <div key={m.id} className="contents">
              {sep && <div className="py-1 text-center text-[12px] text-slate-400">{relDay(m.at)}</div>}
              {m.kind === 'SYSTEM' ? (
                <div className="flex justify-center">
                  <span className="inline-flex max-w-[90%] items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1.5 text-[12px] font-semibold text-primary-700">
                    <CalendarClock size={13} className="flex-none" />
                    {m.text} · {time(m.at)}
                  </span>
                </div>
              ) : (
                <div className={cx('flex flex-col', m.mine ? 'items-end' : 'items-start')}>
                  {!m.mine && <div className="mb-1 ml-1 text-[12px] text-slate-500">{short(m.sender?.name)}</div>}
                  <div className={cx('max-w-[80%] overflow-hidden rounded-2xl text-[15px] leading-[22px] shadow-card', m.mine ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md bg-white text-slate-900', m.pending && 'opacity-70')}>
                    {m.attachmentId && (
                      <a href={`/api/v1/attachments/${m.attachmentId}`} target="_blank" rel="noreferrer" className="block p-1.5 pb-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/v1/attachments/${m.attachmentId}`} alt="Shared photo" className="max-h-[220px] w-full rounded-xl object-cover" />
                      </a>
                    )}
                    {m.text && <div className="whitespace-pre-wrap px-3.5 py-2.5">{m.text}</div>}
                  </div>
                  <div className={cx('mt-0.5 px-1 text-[11px]', m.failed ? 'text-[#B91C1C]' : 'text-slate-400')}>{m.failed ? 'Not sent' : m.pending ? 'Sending…' : time(m.at)}</div>
                </div>
              )}
            </div>
          )
        })}
        <div ref={end} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[480px] border-t border-slate-200 bg-white pb-[max(12px,env(safe-area-inset-bottom))] pt-2.5">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-5">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => sendText(q)} className="h-9 flex-none rounded-full border border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 active:bg-slate-50">
              {q}
            </button>
          ))}
        </div>
        <form
          className="mt-2.5 flex items-center gap-2 px-5"
          onSubmit={(e) => {
            e.preventDefault()
            sendText(text)
          }}
        >
          <button type="button" disabled={sending} onClick={() => file.current?.click()} className="flex size-11 flex-none items-center justify-center rounded-[10px] bg-slate-100 text-slate-700" aria-label="Share a photo">
            {sending ? <Loader2 size={18} className="animate-spin" /> : <Plus size={20} />}
          </button>
          <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => (e.target.files?.[0] && sendPhoto(e.target.files[0]), (e.target.value = ''))} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" className="h-11 min-w-0 flex-1 rounded-full border-[1.5px] border-slate-300 px-4 text-[15px] outline-none focus:border-primary" enterKeyHint="send" />
          <button type="submit" disabled={!text.trim()} className="flex size-11 flex-none items-center justify-center rounded-full bg-primary text-white disabled:opacity-50" aria-label="Send">
            <SendHorizontal size={18} />
          </button>
        </form>
      </div>
    </div>
  )
}
