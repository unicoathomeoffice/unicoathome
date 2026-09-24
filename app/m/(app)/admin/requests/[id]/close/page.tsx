import { redirect } from 'next/navigation'
import { MScreen, MCard } from '@/components/mobile'
import { StatusChip, Avatar, Tag } from '@/components/ui'
import { SLabel, shortName } from '@/components/coord/ui'
import { Line } from '@/components/coord/blocks'
import { PostButton } from '@/components/coord/actions'
import { CloseForm } from '@/components/coord/CloseForm'
import { requireDesk, loadCoordRequest } from '@/components/coord/data'
import { User } from '@/lib/models'
import { can, PAYMENT_METHOD_LABEL, TRANSPORT_MODE_LABEL } from '@/lib/constants'
import { time, dur, taka } from '@/lib/format'

export const metadata = { title: 'Close visit' }

/** S7 (5i) — Stage 7: coordinator / front desk verifies the report, reconciles billing and closes. */
export default async function ClosePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireDesk('billing.invoice')
  const { id } = await params
  const { r, settings } = await loadCoordRequest(id, user)
  if (!['COMPLETED', 'CLOSED'].includes(r.status)) redirect(`/m/admin/requests/${id}`)
  const pcUsers = await User.find({ _id: { $in: (r.pettyCash ?? []).map((p: any) => p.requestedBy).filter(Boolean) } }).select('name').lean<any[]>()
  const team = [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean)
  const v = r.visit ?? {}
  const t = r.timeline ?? {}
  const late = v.lateMin ?? 0
  const b = r.billing ?? {}
  const pending = (r.pettyCash ?? []).filter((p: any) => p.status === 'PENDING').length
  const decide = can(user, 'approvals.decide')
  const transport = r.vehicle ? `${r.vehicle.name}${r.driver ? ` · ${r.driver.name}` : ''}` : r.transport?.mode ? TRANSPORT_MODE_LABEL[r.transport.mode as keyof typeof TRANSPORT_MODE_LABEL] : 'Not recorded'
  const closed = r.status === 'CLOSED'
  return (
    <MScreen title="Close visit" sub={`${r.requestNo} · ${r.patientSnapshot?.name}`} back={`/m/admin/requests/${id}`} right={<StatusChip status={r.status} sm />}>
      <MCard>
        <div className="mb-1.5 text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Visit summary</div>
        <Line k="Team" v={team.map((m: any) => shortName(m.name)).join(' · ') || '—'} />
        <Line k="Time" v={t.checkInAt ? `${time(t.checkInAt)} – ${time(t.checkOutAt)} · ${dur(v.durationMin)} · ${late > (settings.sla?.lateAfterMin ?? 10) ? `${late} min late` : 'on time'}` : '—'} />
        <Line k="Tests" v={(r.tests ?? []).join(' · ') || '—'} />
        <Line k="Transport" v={transport} />
        <Line k="Checklist" v={`${(v.checklist ?? []).filter((c: any) => c.done).length}/${(v.checklist ?? []).length} done`} />
        <Line k="Report" v={v.reportAt ? `Submitted ${time(v.reportAt)}` : 'Not submitted'} />
      </MCard>

      <SLabel>Billing reconciliation</SLabel>
      <MCard>
        <div className="mb-3 flex items-center justify-between gap-2 text-[14px]">
          <span className="text-slate-500">Bill collected by staff</span>
          <span className="font-bold">
            {b.billAmount != null ? `${taka(b.billAmount)} · ${b.status === 'PAID' ? 'Paid' : b.status === 'DUE' ? 'Payment due' : b.status ?? '—'}${b.method ? ` · ${PAYMENT_METHOD_LABEL[b.method as keyof typeof PAYMENT_METHOD_LABEL]}` : ''}` : 'Not recorded'}
          </span>
        </div>
        {closed ? (
          <>
            <Line k="Invoice" v={`${b.invoiceNo} · ${taka(b.invoiceAmount)}`} />
            <Line k="Print" v={b.invoicePrinted ? 'Printed' : 'Not printed'} />
            <Line k="Closed" v={time(t.closedAt)} />
          </>
        ) : (
          <div className="grid gap-3">
            <CloseForm id={id} requestNo={r.requestNo} bill={b.billAmount} billStatus={b.status} invoiceNo={b.invoiceNo} invoiceAmount={b.invoiceAmount} printed={b.invoicePrinted} pendingPettyCash={pending} canClose />
          </div>
        )}
      </MCard>

      {(r.pettyCash ?? []).length > 0 && (
        <>
          <SLabel>Petty cash</SLabel>
          {(r.pettyCash ?? []).map((p: any) => {
            const who = pcUsers.find((u) => String(u._id) === String(p.requestedBy))?.name
            return (
              <MCard key={String(p._id)} pad="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={who} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold">
                      {taka(p.amount)} · {p.purpose}
                    </div>
                    <div className="text-[12px] text-slate-500">
                      {shortName(who)} · {time(p.requestedAt)}
                      {p.note ? ` · ${p.note}` : ''}
                    </div>
                  </div>
                  {p.status === 'PENDING' && decide ? (
                    <div className="flex gap-1.5">
                      <PostButton path={`/requests/${id}/petty-cash-decide`} body={{ pettyCashId: String(p._id), approve: false }} kind="o" success="Petty cash rejected">
                        Reject
                      </PostButton>
                      <PostButton path={`/requests/${id}/petty-cash-decide`} body={{ pettyCashId: String(p._id), approve: true }} kind="p" success="Petty cash approved">
                        Approve
                      </PostButton>
                    </div>
                  ) : (
                    <Tag tone={p.status === 'APPROVED' ? 'green' : p.status === 'REJECTED' ? 'red' : 'amber'}>{p.status}</Tag>
                  )}
                </div>
              </MCard>
            )
          })}
          {pending > 0 && !decide && <div className="text-center text-[12px] text-[#B45309]">A coordinator must decide the petty cash before closing.</div>}
        </>
      )}
      {!closed && <div className={pending ? 'h-[104px]' : 'h-[76px]'} aria-hidden />}
    </MScreen>
  )
}
