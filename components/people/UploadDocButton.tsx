'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Upload } from 'lucide-react'
import { uploadFile, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'

const KINDS = [
  ['REPORT', 'Report'],
  ['PRESCRIPTION', 'Prescription'],
  ['PHOTO', 'Photo'],
  ['OTHER', 'Other'],
] as const

/** Upload a document to the patient's record (JPG / PNG / WEBP / PDF ≤ 3 MB) */
export function UploadDocButton({ patientId }: { patientId: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<string>('REPORT')
  return (
    <div className="flex items-center gap-1.5">
      <select aria-label="Document type" value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-[12.5px] text-slate-700 outline-none">
        {KINDS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <button type="button" className={btnClass('o', 'sm')} disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          setBusy(true)
          try {
            await uploadFile(file, { kind, patientId })
            toast('Document uploaded')
            router.refresh()
          } catch (err: any) {
            toast(err?.message ?? 'Upload failed', 'err')
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}
