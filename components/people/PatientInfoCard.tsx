import type { ReactNode } from 'react'
import { Card, CardHeader, Tag, telUrl } from '@/components/ui'
import { ago, cx, date, phone as fmtPhone } from '@/lib/format'
import { isSeniorCitizen, patientCategoryLabel } from '@/lib/constants'
import { H360RefreshButton } from './H360RefreshButton'

const GENDER: Record<string, string> = { M: 'Male', F: 'Female', O: 'Other' }

/** Category chips for a patient: H360 type, corporate client, senior citizen (60+), VIP / handle with care / fall risk. */
export function PatientCategoryTags({ p, className }: { p: any; className?: string }) {
  const tags: { label: string; tone: 'blue' | 'green' | 'amber' | 'red' | 'violet' }[] = []
  if (p?.category) tags.push({ label: patientCategoryLabel(p.category), tone: /corporate/i.test(p.category) ? 'violet' : 'blue' })
  if (p?.company) tags.push({ label: p.company, tone: 'violet' })
  if (p && isSeniorCitizen(p)) tags.push({ label: 'Senior citizen', tone: 'green' })
  if (p?.flags?.vip) tags.push({ label: 'VIP', tone: 'amber' })
  if (p?.flags?.handleWithCare) tags.push({ label: 'Handle with care', tone: 'amber' })
  if (p?.flags?.fallRisk) tags.push({ label: 'Fall risk', tone: 'red' })
  if (!tags.length) return null
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-1.5', className)}>
      {tags.map((t) => (
        <Tag key={t.label} tone={t.tone}>
          {t.label}
        </Tag>
      ))}
    </span>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  const empty = children == null || children === '' || children === false
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className={cx('min-w-0 break-words', empty && 'text-slate-400')}>{empty ? '—' : children}</dd>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50/70 p-3.5 ring-1 ring-slate-100">
      <div className="mb-2 text-[12px] font-bold uppercase tracking-[.06em] text-slate-500">{title}</div>
      <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">{children}</dl>
    </div>
  )
}

/** "View patient information" — the full profile, as in H360, kept in step with it by UHID (lib/h360-patient.ts). */
export function PatientInfoCard({ p, masked, canRefresh }: { p: any; masked?: boolean; canRefresh?: boolean }) {
  const tel = (n?: string) => (n ? masked ? '•••' : <a href={telUrl(n)} className="font-semibold text-primary-700 hover:underline">{fmtPhone(n)}</a> : null)
  const em = p.guardian ?? {}
  return (
    <Card>
      <CardHeader
        title="Patient information"
        sub={p.h360?.syncedAt ? `From H360 · updated ${ago(p.h360.syncedAt)}` : p.uhid ? 'Not read from H360 yet' : 'Add the UHID to fill this from H360'}
        className="mb-3"
        right={canRefresh && p.uhid ? <H360RefreshButton patientId={String(p._id)} /> : undefined}
      />
      <PatientCategoryTags p={p} className="mb-3" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="Personal">
          <Row k="UHID">{p.uhid}</Row>
          <Row k="Gender">{GENDER[p.gender]}</Row>
          <Row k="Age">{p.h360?.ageText || (p.ageYears != null ? `${p.ageYears} Y` : null)}</Row>
          <Row k="Date of birth">{p.dob ? date(p.dob) : null}</Row>
          <Row k="Blood group">{p.bloodGroup}</Row>
          <Row k="Marital status">{p.maritalStatus}</Row>
          <Row k="Religion">{p.religion}</Row>
          <Row k="Nationality">{p.nationality}</Row>
          <Row k="NID">{masked && p.nid ? '•••' : p.nid}</Row>
          <Row k="Passport">{masked && p.passport ? '•••' : p.passport}</Row>
          <Row k="Occupation">{p.occupation}</Row>
        </Section>
        <div className="flex flex-col gap-3">
          <Section title="Contact">
            <Row k="Mobile">{tel(p.phone)}</Row>
            <Row k="Alt. phone">{tel(p.altPhone)}</Row>
            <Row k="Email">{masked && p.email ? '•••' : p.email}</Row>
          </Section>
          <Section title="Emergency contact">
            <Row k="Name">{em.name}</Row>
            <Row k="Relation">{em.relation}</Row>
            <Row k="Contact">{tel(em.phone)}</Row>
          </Section>
        </div>
        <Section title="Address">
          <Row k="Present">{masked ? (p.address?.full ? '•••' : null) : [p.address?.full, p.address?.area].filter(Boolean).join(', ')}</Row>
          <Row k="Permanent">{masked && p.permanentAddress ? '•••' : p.permanentAddress}</Row>
        </Section>
        <Section title="Payer & family">
          <Row k="Category">{patientCategoryLabel(p.category)}</Row>
          <Row k="Company">{p.company}</Row>
          <Row k="Payer type">{p.payer?.type}</Row>
          <Row k="Payer">{p.payer?.name}</Row>
          <Row k="Father">{p.family?.father}</Row>
          <Row k="Mother">{p.family?.mother}</Row>
          <Row k="Spouse">{p.family?.spouse}</Row>
        </Section>
      </div>
      {p.h360?.remarks && <div className="mt-3 text-[12.5px] text-slate-500">H360 remarks: {p.h360.remarks}</div>}
    </Card>
  )
}
