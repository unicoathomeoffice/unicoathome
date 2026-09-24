'use client'
import Link from 'next/link'
import { Phone, FileText, FilePlus, Download } from 'lucide-react'
import { WhatsAppButton } from '@/components/client'
import { btnClass, telUrl } from '@/components/ui'
import { useSearchParams } from 'next/navigation'

const icon = 'inline-flex size-8 flex-none items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'

/** Per-row quick actions on the patient board: Call · WhatsApp · Open · New request */
export function PatientRowActions({ id, name, phone, text, canMessage, canCreate }: { id: string; name: string; phone: string; text: string; canMessage: boolean; canCreate: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {canMessage && (
        <a href={telUrl(phone)} className={icon} title={`Call ${name}`} aria-label={`Call ${name}`}>
          <Phone size={15} />
        </a>
      )}
      {canMessage && (
        <WhatsAppButton patientId={id} to="patient" text={text} kind="ghost" size="sm" className={`${icon} !h-8 !px-0`}>
          <span className="sr-only">WhatsApp {name}</span>
        </WhatsAppButton>
      )}
      <Link href={`/patients/${id}`} className={icon} title="Open profile" aria-label={`Open ${name}`}>
        <FileText size={15} />
      </Link>
      {canCreate && (
        <Link href={`/requests/new?patientId=${id}`} className={icon} title="New request for this patient" aria-label={`New request for ${name}`}>
          <FilePlus size={15} />
        </Link>
      )}
    </div>
  )
}

/** Export the currently filtered board as CSV (server route keeps the same filters) */
export function ExportCsvButton({ base = '/patients/export' }: { base?: string }) {
  const sp = useSearchParams()
  const qs = new URLSearchParams(sp.toString())
  qs.delete('page')
  const s = qs.toString()
  return (
    <a href={`${base}${s ? `?${s}` : ''}`} className={btnClass('o')} download>
      <Download size={16} /> Export
    </a>
  )
}
