import { MScreen } from '@/components/mobile'
import { requireDesk } from '@/components/coord/data'
import { Equipment } from '@/lib/models'
import { MASTER } from '@/lib/master'
import { can } from '@/lib/constants'
import { plain } from '@/lib/db'
import { EquipmentEditor } from '@/components/admin-settings/EquipmentEditor'

export const metadata = { title: 'Store' }

/** The Family Medicine store on the phone: stock by family (sizes & companies); store managers can receive / count. */
export default async function MobileStore() {
  const user = await requireDesk('requests.manage')
  const items = await Equipment.find({ isActive: { $ne: false } }).sort(MASTER.equipment.sort).lean<any[]>()
  return (
    <MScreen title="Store" sub="Nursing Services – Family Medicine" back="/m/admin">
      <div className="px-4 py-4">
        <EquipmentEditor items={plain(items)} canEdit={false} canStock={can(user, 'store.manage')} />
      </div>
    </MScreen>
  )
}
