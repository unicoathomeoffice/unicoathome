'use client'
// Custom messages: to the patient of a request (ComposeButton) and to staff groups / people (BroadcastButton).
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Mail, Megaphone, MessageCircle, Send } from 'lucide-react'
import { api, ChipPicker, Drawer, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { ROLES, ROLE_LABEL } from '@/lib/constants'
import { cx } from '@/lib/format'

type Contact = { name?: string; email?: string | null; phone?: string | null }

export function ComposeButton({ requestId, contact, whatsappLive }: { requestId: string; contact: Contact; whatsappLive: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<'WHATSAPP' | 'EMAIL'>(contact.phone ? 'WHATSAPP' : 'EMAIL')
  const [subject, setSubject] = useState('')
  const [text, setText] = useState(`Dear ${contact.name ?? 'patient'},\n\n`)
  const [busy, setBusy] = useState(false)

  async function send() {
    setBusy(true)
    try {
      const r = await api<{ auto?: boolean; url?: string; channel: string }>('/messages/custom', { body: { requestId, channel, subject: subject || undefined, text } })
      if (r.channel === 'WHATSAPP' && !r.auto && r.url) {
        window.open(r.url, '_blank', 'noopener')
        toast('WhatsApp opened with your message — tap Send there', 'ok')
      } else toast(r.channel === 'EMAIL' ? 'Email queued' : 'WhatsApp message queued', 'ok')
      setOpen(false)
      setText(`Dear ${contact.name ?? 'patient'},\n\n`)
      setSubject('')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnClass('o', 'sm')}>
        <Send size={14} /> New message
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Message the patient"
        sub={[contact.name, contact.phone, contact.email].filter(Boolean).join(' · ')}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={btnClass('o', 'md')}>
              Cancel
            </button>
            <button type="button" onClick={send} disabled={busy || !text.trim() || (channel === 'EMAIL' && !contact.email) || (channel === 'WHATSAPP' && !contact.phone)} className={btnClass('p', 'md')}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : channel === 'EMAIL' ? <Mail size={16} /> : <MessageCircle size={16} />} {channel === 'EMAIL' ? 'Send email' : whatsappLive ? 'Send WhatsApp' : 'Open WhatsApp'}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex gap-1 rounded-lg bg-slate-200 p-1 text-[13px] font-semibold">
            {(
              [
                ['WHATSAPP', 'WhatsApp', !!contact.phone],
                ['EMAIL', 'Email', !!contact.email],
              ] as const
            ).map(([k, l, ok]) => (
              <button key={k} type="button" disabled={!ok} onClick={() => setChannel(k)} className={cx('h-9 flex-1 rounded-md', channel === k ? 'bg-slate-900 text-white' : 'text-slate-600 disabled:text-slate-400')}>
                {l}
                {!ok && ' · none'}
              </button>
            ))}
          </div>
          {channel === 'EMAIL' && (
            <label className="block">
              <span className="hc-label">Subject</span>
              <input className="hc-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Unico Hospitals · your home care visit" />
            </label>
          )}
          <label className="block">
            <span className="hc-label">Message</span>
            <textarea className="hc-input" rows={9} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <p className="text-[12.5px] text-slate-500">{channel === 'WHATSAPP' ? (whatsappLive ? 'Sent from the hospital WhatsApp automatically and logged under Messages.' : 'WhatsApp is not connected: the message opens in your WhatsApp pre-filled, and is logged as prepared.') : 'Sent from the department Gmail and logged under Messages.'}</p>
        </div>
      </Drawer>
    </>
  )
}

export function BroadcastButton({ people }: { people: { id: string; name: string; role: string }[] }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [roles, setRoles] = useState<string[]>([])
  const [userIds, setUserIds] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [channels, setChannels] = useState<string[]>(['inapp'])
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const hits = q.trim() ? people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) && !userIds.includes(p.id)).slice(0, 8) : []

  async function send() {
    setBusy(true)
    try {
      const r = await api<any>('/messages/broadcast', { body: { roles, userIds, channels, title, text } })
      toast(`Sent to ${r.people} people · in-app ${r.inapp} · email ${r.email} · WhatsApp ${r.whatsapp}${r.whatsappSkipped ? ` (${r.whatsappSkipped} skipped: WhatsApp not connected)` : ''}`, 'ok')
      setOpen(false)
      setTitle('')
      setText('')
      setRoles([])
      setUserIds([])
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnClass('p')}>
        <Megaphone size={16} /> New message
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Message staff"
        sub="Groups and individuals · in-app, email, WhatsApp"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={btnClass('o', 'md')}>
              Cancel
            </button>
            <button type="button" onClick={send} disabled={busy || !title.trim() || !text.trim() || !channels.length || (!roles.length && !userIds.length)} className={btnClass('p', 'md')}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <span className="hc-label">Groups</span>
            <ChipPicker options={ROLES.filter((r) => r !== 'SUPER_ADMIN').map((r) => ({ value: r, label: ROLE_LABEL[r] }))} value={roles} onChange={setRoles} />
          </div>
          <div>
            <span className="hc-label">People</span>
            {userIds.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {userIds.map((id) => {
                  const p = people.find((x) => x.id === id)
                  return (
                    <button key={id} type="button" onClick={() => setUserIds((u) => u.filter((x) => x !== id))} className="h-8 rounded-full bg-slate-900 px-3 text-[12.5px] font-semibold text-white">
                      {p?.name ?? id} ×
                    </button>
                  )
                })}
              </div>
            )}
            <input className="hc-input" placeholder="Type a name…" value={q} onChange={(e) => setQ(e.target.value)} />
            {hits.length > 0 && (
              <div className="mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white">
                {hits.map((p) => (
                  <button key={p.id} type="button" onClick={() => (setUserIds((u) => [...u, p.id]), setQ(''))} className="flex w-full items-center justify-between px-3 py-2 text-left text-[13.5px] hover:bg-slate-50">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-[12px] text-slate-500">{ROLE_LABEL[p.role as keyof typeof ROLE_LABEL] ?? p.role}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <span className="hc-label">Channels</span>
            <ChipPicker
              options={[
                { value: 'inapp', label: 'In-app' },
                { value: 'email', label: 'Email' },
                { value: 'whatsapp', label: 'WhatsApp' },
              ]}
              value={channels}
              onChange={setChannels}
            />
          </div>
          <label className="block">
            <span className="hc-label">Title</span>
            <input className="hc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Duty roster change on Friday" />
          </label>
          <label className="block">
            <span className="hc-label">Message</span>
            <textarea className="hc-input" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
        </div>
      </Drawer>
    </>
  )
}
