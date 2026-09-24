import { requireWebUser } from '@/lib/auth'
import { Zone, User } from '@/lib/models'
import { MASTER } from '@/lib/master'
import { getSettings } from '@/lib/settings'
import { can } from '@/lib/constants'
import { plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { Card } from '@/components/ui'
import { MasterList } from '@/components/admin-settings/MasterList'
import { RulesEditor } from '@/components/admin-settings/RulesEditor'

export const metadata = { title: 'Zones, slots & rules · Unico HomeCare' }

export default async function ZonesPage() {
  const user = await requireWebUser('requests.manage')
  const [zones, staff, settings] = await Promise.all([
    Zone.find({}).sort(MASTER.zones.sort).lean<any[]>(),
    User.aggregate([{ $match: { deletedAt: null, status: 'ACTIVE', role: { $in: ['DOCTOR', 'NURSE', 'ALLIED'] } } }, { $unwind: '$zones' }, { $group: { _id: '$zones', n: { $sum: 1 } } }]),
    getSettings(),
  ])
  for (const z of zones) z.inUse = staff.find((s) => s._id === z.name)?.n ?? 0
  const canZones = can(user, 'master.manage')

  return (
    <AdminPage title="Zones, slots & rules" crumbs="Settings">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,.8fr)_minmax(0,.9fr)]">
        <Card className="self-start">
          <MasterList
            kind="zones"
            title={`Zones · ${zones.length}`}
            addLabel="Add zone"
            addKind="o"
            nameKey="name"
            usageLabel="Staff"
            usageNoun="staff member"
            canEdit={canZones}
            items={plain(zones)}
            cols={[
              { key: 'name', label: 'Zone', width: 'minmax(120px,1.4fr)', bold: true, placeholder: 'Lalmatia' },
              { key: 'travelBufferMin', label: 'Buffer', width: '70px', type: 'number', suffix: ' min', placeholder: '45', hint: 'Travel time added around each visit in this zone' },
            ]}
            footer={<p className="mt-3 text-[12px] text-slate-500">Buffer = travel time added around each visit when checking staff availability. Staff = active field staff covering the zone.{!canZones && ' A super admin edits zones.'}</p>}
          />
        </Card>
        <RulesEditor value={plain({ general: settings.general, sla: settings.sla })} canEdit={can(user, 'requests.manage')} />
      </div>
    </AdminPage>
  )
}
