import { requireWebUser } from '@/lib/auth'
import { ServiceType } from '@/lib/models'
import { MASTER } from '@/lib/master'
import { can } from '@/lib/constants'
import { plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { ServicesEditor } from '@/components/admin-settings/ServicesEditor'

export const metadata = { title: 'Service types · Unico HomeCare' }

export default async function ServicesPage() {
  const user = await requireWebUser('requests.manage')
  const services = await ServiceType.find({}).sort(MASTER['service-types'].sort).lean<any[]>()
  const use = await MASTER['service-types'].usage!(services.map((s) => s._id))
  for (const s of services) s.inUse = use[String(s._id)] ?? 0
  return (
    <AdminPage title="Service types & checklists" crumbs="Settings">
      <ServicesEditor services={plain(services)} canEdit={can(user, 'master.manage')} />
    </AdminPage>
  )
}
