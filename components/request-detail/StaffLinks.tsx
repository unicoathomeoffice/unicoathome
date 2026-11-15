'use client'
// Request page → Assignment: each team member's no-login bag & checklist link (also sent in their assignment WhatsApp).
// Copy it, or make a new one (the old link stops working at once).
import { useState } from 'react'
import { Check, Copy, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { api, useToast } from '@/components/client'

export function StaffLinks({ requestId, team }: { requestId: string; team: { id: string; name: string }[] }) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  async function get(userId: string, fresh: boolean) {
    setBusy(userId + (fresh ? 'new' : 'copy'))
    try {
      const r = await api<{ url: string }>(`/requests/${requestId}/staff-link`, { body: { userId, fresh } })
      await navigator.clipboard.writeText(r.url).catch(() => {})
      setCopied(userId)
      setTimeout(() => setCopied(null), 2000)
      toast(fresh ? 'New link copied — the old one no longer works' : 'Link copied', 'ok')
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  if (!team.length) return null
  return (
    <div className="mt-3.5 rounded-[10px] border border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600">
        <KeyRound size={14} className="text-primary-700" /> Staff links · bag &amp; checklist, no login (employee ID once)
      </div>
      <div className="flex flex-col gap-1.5">
        {team.map((m) => (
          <div key={m.id} className="flex items-center gap-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
            <button type="button" disabled={!!busy} onClick={() => get(m.id, false)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold text-primary-700 ring-1 ring-slate-200 hover:bg-primary-50 disabled:opacity-50">
              {busy === m.id + 'copy' ? <Loader2 size={13} className="animate-spin" /> : copied === m.id ? <Check size={13} /> : <Copy size={13} />} Copy
            </button>
            <button type="button" disabled={!!busy} onClick={() => confirm(`Make a new link for ${m.name}? The old link stops working.`) && get(m.id, true)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50" title="New link — the old one stops working">
              {busy === m.id + 'new' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} New
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
