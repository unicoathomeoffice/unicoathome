import { requireWebUser } from '@/lib/auth'
import { Equipment } from '@/lib/models'
import { MASTER } from '@/lib/master'
import { can } from '@/lib/constants'
import { plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { EquipmentEditor } from '@/components/admin-settings/EquipmentEditor'

export const metadata = { title: 'Equipment & consumables · Unico HomeCare' }

/** The catalog of instruments and consumables (pictures, unit, type) that the services' bags are built from. */
export default async function EquipmentPage() {
  const user = await requireWebUser('requests.manage')
  const items = await Equipment.find({}).sort(MASTER.equipment.sort).lean<any[]>()
  const use = await MASTER.equipment.usage!(items.map((i) => i._id))
  for (const i of items) i.inUse = use[String(i._id)] ?? 0
  return (
    <AdminPage title="Equipment & consumables" crumbs="Settings">
      <EquipmentEditor items={plain(items)} canEdit={can(user, 'master.manage')} />
    </AdminPage>
  )
}
