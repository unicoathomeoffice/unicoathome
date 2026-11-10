import { requireWebUser } from '@/lib/auth'
import { Equipment, ServiceType } from '@/lib/models'
import { MASTER } from '@/lib/master'
import { can } from '@/lib/constants'
import { plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { ServicesEditor } from '@/components/admin-settings/ServicesEditor'
import { afterChecklistOf } from '@/lib/services/after-checklist'

export const metadata = { title: 'Service types · Unico HomeCare' }

export default async function ServicesPage() {
  const user = await requireWebUser('requests.manage')
  const services = await ServiceType.find({}).sort(MASTER['service-types'].sort).lean<any[]>()
  const use = await MASTER['service-types'].usage!(services.map((s) => s._id))
  for (const s of services) {
    s.inUse = use[String(s._id)] ?? 0
    // never saved an after-return list: show the built-in defaults (saving keeps or changes them)
    s.afterIsDefault = !Array.isArray(s.afterChecklist)
    s.afterChecklist = afterChecklistOf(s).map((c, i) => ({ ...c, sortOrder: c.sortOrder ?? i }))
  }
  return (
    <AdminPage title="Service types & checklists" crumbs="Settings">
      <ServicesEditor services={plain(services)} canEdit={can(user, 'master.manage')} catalog={plain(await Equipment.find({}).sort({ sortOrder: 1, name: 1 }).select('name type unit imageId isActive').lean<any[]>())} />
    </AdminPage>
  )
}
