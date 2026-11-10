import { MScreen } from '@/components/mobile'
import { Col } from '@/components/field/bar'
import { FHeader, vHref } from '@/components/field'
import { loadVisit } from '@/components/field/data'
import { ConsumablesEditor } from '@/components/field/consumables'
import { Equipment } from '@/lib/models'
import { can } from '@/lib/constants'
import { plain } from '@/lib/db'
import { actsForTeam } from '@/lib/services/requests'
import { ensureKit } from '@/lib/services/kit'

export const metadata = { title: 'Consumables used' }

/** Consumables used on the visit: pre-filled with the service's usual use until something is saved. */
export default async function Consumables({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { r, team, user } = await loadVisit(id)
  const kit: any[] = await ensureKit(r)
  const catalog = await Equipment.find({ type: 'CONSUMABLE', isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('name unit imageId').lean<any[]>()
  const saved = (r.visit?.consumables ?? []).filter((c: any) => c.itemId)
  const initial = saved.length
    ? saved.map((c: any) => ({ itemId: String(c.itemId), qty: c.qty }))
    : kit.filter((k) => k.type === 'CONSUMABLE' && (k.usualUse ?? 0) > 0).map((k) => ({ itemId: String(k.itemId), qty: k.usualUse }))
  // items no longer in the active catalog still show on this visit
  for (const c of [...saved, ...kit]) if (c.itemId && !catalog.some((x) => String(x._id) === String(c.itemId))) catalog.push({ _id: c.itemId, name: c.item ?? c.name, unit: c.unit ?? 'pcs', imageId: c.imageId })
  const coordinator = can(user, 'requests.manage')
  const editable = coordinator || ((team || actsForTeam(user, r)) && !!r.timeline?.checkInAt && !['CLOSED', 'CANCELLED'].includes(r.status))
  const free = (r.visit?.consumables ?? []).filter((c: any) => !c.itemId)
  return (
    <MScreen header={<FHeader back={vHref(id)} title="Consumables used" sub={`${r.patientSnapshot?.name ?? ''} · ${r.requestNo}`} />}>
      <Col>
        {!r.timeline?.checkInAt && !coordinator && <div className="rounded-card bg-[#FEF3C7] px-4 py-3 text-[13.5px] text-[#92400E]">Record consumables once you have checked in.</div>}
        {!saved.length && initial.length > 0 && editable && <div className="text-[13px] text-slate-500">Pre-filled with the usual use for this service — change what you actually used, then save.</div>}
        <ConsumablesEditor requestId={id} catalog={plain(catalog)} initial={initial} editable={editable} back={vHref(id)} />
        {free.length > 0 && <div className="text-[12.5px] text-slate-500">Also noted on the Notes screen: {free.map((c: any) => `${c.item} × ${c.qty}`).join(' · ')}</div>}
      </Col>
    </MScreen>
  )
}
