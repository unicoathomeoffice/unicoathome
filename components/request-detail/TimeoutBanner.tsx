'use client'
// Request page: the staff member didn't accept within the window. Nobody is removed automatically — the coordinator
// chooses: keep waiting, accept for them (override access) or reassign.
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Clock, Loader2, RefreshCw, UserCheck, Users } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'

export function TimeoutBanner({ requestId, requestNo, staffName, since, windowMin, canOverride, canAssign }: { requestId: string; requestNo: string; staffName: string; since: string; windowMin: number; canOverride: boolean; canAssign: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const at = new Date(since).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit', hour12: true })
  const first = staffName.replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(' ')[0]

  async function act(action: 'accept-wait' | 'accept', ask: string, done: string) {
    if (!confirm(ask)) return
    setBusy(action)
    try {
      await api(`/requests/${requestId}/${action}`, { body: {} })
      toast(done, 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-[#FEF3C7] px-3.5 py-2.5 ring-1 ring-[#FCD34D]">
      <Clock size={17} className="flex-none text-[#B45309]" />
      <div className="min-w-0 text-[13.5px] text-[#92400E]">
        <b>{staffName} hasn’t accepted yet</b> · the {windowMin} min window ended at {at}. They are still on the visit — choose what to do.
      </div>
      <div className="ml-auto flex flex-wrap gap-2">
        {canAssign && (
          <button type="button" disabled={!!busy} className={btnClass('o', 'sm', 'bg-white')} onClick={() => act('accept-wait', `Give ${staffName} another ${windowMin} minutes to accept ${requestNo}?`, `Waiting ${windowMin} more min for ${first}`)}>
            {busy === 'accept-wait' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Keep waiting {windowMin} min
          </button>
        )}
        {canOverride && (
          <button type="button" disabled={!!busy} className={btnClass('o', 'sm', 'bg-white')} onClick={() => act('accept', `Accept ${requestNo} on behalf of ${staffName}?\n\nRecorded as accepted by you for them.`, `Accepted for ${first}`)}>
            {busy === 'accept' ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />} Accept for {first}
          </button>
        )}
        {canAssign && (
          <Link href={`/requests/${requestId}?assign=1`} scroll={false} className={btnClass('p', 'sm')}>
            <Users size={14} /> Reassign
          </Link>
        )}
      </div>
    </div>
  )
}
