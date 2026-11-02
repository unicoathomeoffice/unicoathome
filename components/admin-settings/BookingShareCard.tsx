'use client'
import { useState } from 'react'
import { Check, ClipboardCopy, ExternalLink, Link2, MessageCircle } from 'lucide-react'
import { btnClass } from '@/components/ui'

/** Settings → Online booking: the public short link to the booking page (/s/book), to share anywhere. */
export function BookingShareCard({ url, clicks, last }: { url: string; clicks: number; last?: string | null }) {
  const [copied, setCopied] = useState(false)
  const text = `Book a doctor, nurse or lab test at home — Unico HomeCare (Unico Hospitals): ${url}`
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <section className="rounded-card bg-white p-5 shadow-card xl:col-span-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-10 flex-none items-center justify-center rounded-full bg-primary-50 text-primary-700">
          <Link2 size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold">Public booking link</h2>
          <p className="text-[12.5px] text-slate-500">Share on Facebook, WhatsApp, SMS or flyers — opens the booking page and shows a preview card with the Unico logo.</p>
        </div>
        <div className="text-right text-[12.5px] text-slate-500">
          <b className="text-[18px] text-slate-900">{clicks.toLocaleString('en-IN')}</b> opens
          {last && <div>last {last}</div>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-3 py-2.5 text-[14px] font-semibold text-primary-700 ring-1 ring-slate-200">{url}</code>
        <button type="button" onClick={copy} className={btnClass('p', 'md')}>
          {copied ? <Check size={16} /> : <ClipboardCopy size={16} />} {copied ? 'Copied' : 'Copy link'}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className={btnClass('g', 'md')}>
          <MessageCircle size={16} /> Share on WhatsApp
        </a>
        <a href={url} target="_blank" rel="noreferrer" className={btnClass('o', 'md')}>
          <ExternalLink size={16} /> Open
        </a>
      </div>
    </section>
  )
}
