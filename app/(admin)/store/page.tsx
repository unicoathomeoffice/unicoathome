import { redirect } from 'next/navigation'
import { requireWebUser } from '@/lib/auth'
import { Equipment, Setting, User } from '@/lib/models'
import { MASTER } from '@/lib/master'
import { can } from '@/lib/constants'
import { plain } from '@/lib/db'
import { isoDay } from '@/lib/format'
import { AdminPage } from '@/components/admin/AdminPage'
import { Tabs } from '@/components/ui'
import { EquipmentEditor } from '@/components/admin-settings/EquipmentEditor'
import { ConsumptionList } from '@/components/store/ConsumptionList'
import { listConsumptions } from '@/lib/services/store-consumption'
import { StoreReconcile } from '@/components/store/StoreReconcile'

export const metadata = { title: 'Store · Family Medicine' }

/** The Family Medicine store: items with stock grouped by family (sizes & companies), and consumption entered by hand. */
export default async function StorePage({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string; reason?: string }> }) {
  const user = await requireWebUser()
  if (!can(user, 'requests.manage') && !can(user, 'store.manage')) redirect('/dashboard?denied=1')
  const sp = await searchParams
  const manage = can(user, 'store.manage')
  const tab = manage && (sp.tab === 'consumption' || sp.tab === 'h360') ? sp.tab : 'items'
  const last = manage ? await Setting.findOne({ key: 'store:lastCompare' }).lean<any>() : null
  const items = await Equipment.find({}).sort(MASTER.equipment.sort).lean<any[]>()
  const tabs = [
    { key: 'items', label: 'Items & stock', href: '/store' },
    ...(manage
      ? [
          { key: 'h360', label: 'H360 match', href: '/store?tab=h360', count: last?.value?.differences ?? undefined },
          { key: 'consumption', label: 'Consumption', href: '/store?tab=consumption' },
        ]
      : []),
  ]
  if (tab === 'h360') {
    // people who can follow a difference up (store managers)
    const staff = await User.find({ status: 'ACTIVE', deletedAt: null, $or: [{ role: { $in: ['SUPER_ADMIN', 'HC_ADMIN'] } }, { roles: { $in: ['SUPER_ADMIN', 'HC_ADMIN'] } }] }).sort({ name: 1 }).select('name').lean<any[]>()
    return (
      <AdminPage title="Store" crumbs="Nursing Services – Family Medicine · matched with H360">
        <Tabs items={tabs} active={tab} className="mb-4" />
        <StoreReconcile staff={staff.map((u) => ({ id: String(u._id), name: u.name }))} />
      </AdminPage>
    )
  }
  if (tab === 'consumption') {
    const month = sp.month ?? isoDay().slice(0, 7)
    const rows = await listConsumptions({ month: month || undefined, reason: sp.reason })
    return (
      <AdminPage title="Store" crumbs="Nursing Services – Family Medicine · equipment & consumables">
        <Tabs items={tabs} active={tab} className="mb-4" />
        <ConsumptionList rows={rows} items={plain(items.filter((i) => i.isActive !== false))} month={month} reason={sp.reason ?? ''} canManage={manage} />
      </AdminPage>
    )
  }
  const use = await MASTER.equipment.usage!(items.map((i) => i._id))
  for (const i of items) i.inUse = use[String(i._id)] ?? 0
  return (
    <AdminPage title="Store" crumbs="Nursing Services – Family Medicine · equipment & consumables">
      {tabs.length > 1 && <Tabs items={tabs} active={tab} className="mb-4" />}
      <EquipmentEditor items={plain(items)} canEdit={can(user, 'master.manage')} canStock={manage} />
    </AdminPage>
  )
}
