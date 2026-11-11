import { redirect } from 'next/navigation'
import { requireWebUser } from '@/lib/auth'
import { Equipment } from '@/lib/models'
import { MASTER } from '@/lib/master'
import { can } from '@/lib/constants'
import { plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { EquipmentEditor } from '@/components/admin-settings/EquipmentEditor'

export const metadata = { title: 'Store · Family Medicine' }

/** The Family Medicine store: every item with its stock, grouped by family (sizes and companies). */
export default async function StorePage() {
  const user = await requireWebUser()
  if (!can(user, 'requests.manage') && !can(user, 'store.manage')) redirect('/dashboard?denied=1')
  const items = await Equipment.find({}).sort(MASTER.equipment.sort).lean<any[]>()
  const use = await MASTER.equipment.usage!(items.map((i) => i._id))
  for (const i of items) i.inUse = use[String(i._id)] ?? 0
  return (
    <AdminPage title="Store" crumbs="Nursing Services – Family Medicine · equipment & consumables">
      <EquipmentEditor items={plain(items)} canEdit={can(user, 'master.manage')} canStock={can(user, 'store.manage')} />
    </AdminPage>
  )
}
