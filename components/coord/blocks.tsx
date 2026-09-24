// Server components shared by the coordinator request screens.
import type { ReactNode } from 'react'
import { ContactBar, MCard } from '@/components/mobile'
import { Avatar, StatusChip } from '@/components/ui'
import { relDay, time, cx } from '@/lib/format'
import { ageG, shortName } from './ui'

/** S2 top card: avatar, name · age G, "Requested by … · today 15:52", status chip, Call / WhatsApp / Map. */
export function PatientSummaryCard({ r, patient, contact = true, extra }: { r: any; patient?: any; contact?: boolean; extra?: ReactNode }) {
  const p = r.patientSnapshot ?? {}
  const by = r.createdByUser?.name ? shortName(r.createdByUser.name) : r.requester?.name
  const at = r.timeline?.requestedAt ?? r.createdAt
  return (
    <MCard pad="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <Avatar name={p.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">
            {p.name} <span className="font-normal text-slate-500">· {ageG(p.ageYears, p.gender)}</span>
          </div>
          <div className="text-[12px] text-slate-500">
            {by ? `Requested by ${by} · ` : ''}
            {relDay(at).toLowerCase() === 'today' ? 'today' : relDay(at)} {time(at)}
          </div>
        </div>
        <StatusChip status={r.status} sm />
      </div>
      {extra}
      {contact && (
        <div className="mt-3">
          <ContactBar soft phone={p.phone} address={p.address} lat={patient?.address?.lat} lng={patient?.address?.lng} />
        </div>
      )}
    </MCard>
  )
}

/** Key/value line for small summary cards (S7 visit summary). */
export function Line({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cx('flex gap-3 py-[5px] text-[14px]', className)}>
      <div className="w-[84px] flex-none text-slate-500">{k}</div>
      <div className="min-w-0 flex-1 text-slate-900">{v ?? '—'}</div>
    </div>
  )
}
