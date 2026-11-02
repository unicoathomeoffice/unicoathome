'use client'
// Patients page: live H360 matches for the current search (?q=). "New request" opens the new-request form with the
// same search typed in, so one click on "Use" fills the patient from H360.
import { useRouter } from 'next/navigation'
import { H360PatientSearch } from '@/components/client/H360PatientSearch'

export function PatientsH360({ q }: { q: string }) {
  const router = useRouter()
  return (
    <H360PatientSearch
      q={q}
      className="mb-4 bg-white"
      useLabel="Open / new request"
      onUse={(p) => router.push(p.linkedPatientId ? `/patients/${p.linkedPatientId}` : `/requests/new?q=${encodeURIComponent(p.uhid || p.phone || p.name)}`)}
    />
  )
}
