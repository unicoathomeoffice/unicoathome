'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'

/** Re-read the patient's profile from H360 now (category, DOB, religion, emergency contact…). */
export function H360RefreshButton({ patientId }: { patientId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      const r = await api<{ changed: string[] }>(`/patients/${patientId}/h360`, { method: 'POST' })
      toast(r.changed.length ? `Updated from H360 · ${r.changed.length} field${r.changed.length === 1 ? '' : 's'}` : 'Already up to date with H360', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e?.message ?? 'Could not reach H360', 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={run} disabled={busy} className={btnClass('o', 'sm')}>
      {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh from H360
    </button>
  )
}
