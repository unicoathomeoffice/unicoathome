import { redirect } from 'next/navigation'
import { MScreen } from '@/components/mobile'
import { checklistStats, vHref } from '@/components/field'
import { loadVisit } from '@/components/field/data'
import { CheckoutScreen } from '@/components/field/checkout'
import { Attachment } from '@/lib/models'
import { getSettings } from '@/lib/settings'
import { can, VITALS, TRANSPORT_MODE_LABEL } from '@/lib/constants'

export const metadata = { title: 'Check-out' }

/** M13 Check-out & completion (M13 1h + S6 5h) */
export default async function Checkout({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { r, team, user } = await loadVisit(id)
  if (!team || !['IN_PROGRESS', 'COMPLETED', 'CLOSED'].includes(r.status)) redirect(vHref(id))
  const s = await getSettings()
  const ck = checklistStats(r)
  const v = r.visit ?? {}
  const vit = v.vitals ?? {}
  const photos = await Attachment.countDocuments({ requestId: r._id, deletedAt: null, kind: { $in: ['WOUND_PHOTO', 'DRESSING_PHOTO', 'SAMPLE_LABEL', 'PHOTO'] } })
  const bad = (k: string) => (vit.abnormal ?? []).includes(k)
  const parts: { label: string; value: string; bad?: boolean }[] = []
  if (vit.bpSys != null) parts.push({ label: 'BP', value: `${vit.bpSys}/${vit.bpDia ?? '—'}`, bad: bad('bpSys') || bad('bpDia') })
  for (const k of ['pulse', 'tempC', 'spo2', 'rbs'] as const) {
    if (vit[k] == null) continue
    const d = VITALS.find((x) => x.key === k)!
    parts.push({ label: k === 'tempC' ? 'temp' : k === 'spo2' ? 'SpO₂' : d.label.split(' ')[0], value: `${vit[k]}${k === 'spo2' ? '%' : ''}`, bad: bad(k) })
  }
  const mode = r.transport?.mode
  const tLabel = mode === 'UNICO_CAR' ? [r.vehicle?.name, r.driver?.name].filter(Boolean).join(' · ') || 'Unico car' : mode ? TRANSPORT_MODE_LABEL[mode as 'UBER'] : undefined
  return (
    <MScreen pad={false}>
      <CheckoutScreen
        id={id}
        requestNo={r.requestNo}
        patient={r.patientSnapshot?.name}
        patientId={String(r.patientId)}
        status={r.status}
        checkInAt={r.timeline?.checkInAt}
        checkOutAt={r.timeline?.checkOutAt}
        durationMin={v.durationMin}
        plannedMin={r.expectedDurationMin ?? 45}
        lateMin={v.lateMin}
        overtimePct={s.sla.overtimePct}
        ck={{ done: ck.done, total: ck.total, mand: ck.mand, last: ck.last, missing: ck.missing.map((m: any) => ({ key: m.key, label: m.label })) }}
        vitals={{ at: vit.recordedAt, parts }}
        photos={photos}
        meds={(v.medications ?? []).length}
        notes={!!(v.notes?.nursing || v.notes?.clinical)}
        confirmation={v.confirmation?.at ? v.confirmation : null}
        estimatedFee={r.billing?.estimatedFee ?? null}
        billing={{ billAmount: r.billing?.billAmount, status: r.billing?.status, method: r.billing?.method }}
        transport={{ mode, label: tLabel }}
        remarks={v.remarks ?? ''}
        canFollowUp={can(user, 'requests.create')}
      />
    </MScreen>
  )
}
