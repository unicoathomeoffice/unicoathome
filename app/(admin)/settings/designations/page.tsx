import { requireWebUser } from '@/lib/auth'
import { Department, Designation } from '@/lib/models'
import { MASTER } from '@/lib/master'
import { plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { Card } from '@/components/ui'
import { MasterList } from '@/components/admin-settings/MasterList'

export const metadata = { title: 'Designations & departments · Unico HomeCare' }

export default async function DesignationsPage() {
  await requireWebUser('master.manage')
  const [departments, designations] = await Promise.all([Department.find({}).sort(MASTER.departments.sort).lean<any[]>(), Designation.find({}).sort(MASTER.designations.sort).lean<any[]>()])
  const [deptUse, desigUse] = await Promise.all([MASTER.departments.usage!(departments.map((d) => d._id)), MASTER.designations.usage!(designations.map((d) => d._id))])
  for (const d of departments) d.inUse = deptUse[String(d._id)] ?? 0
  for (const d of designations) d.inUse = desigUse[String(d._id)] ?? 0
  const deptOptions = departments.map((d) => ({ value: String(d._id), label: d.name as string }))

  return (
    <AdminPage title="Designations & departments" crumbs="Settings">
      <p className="mb-5 max-w-3xl text-[13px] text-slate-500">
        A <b className="text-slate-700">designation</b> is the HR title shown on profiles, visit reports and patient messages; the <b className="text-slate-700">role</b> (permissions) is set per user. Records in use can be deactivated but not deleted.
      </p>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card>
          <MasterList
            kind="designations"
            title={`Designations · ${designations.length}`}
            addLabel="Add designation"
            nameKey="title"
            usageLabel="In use"
            usageNoun="user"
            items={plain(designations)}
            cols={[
              { key: 'title', label: 'Title', width: 'minmax(150px,1.6fr)', bold: true, placeholder: 'Senior Staff Nurse' },
              { key: 'departmentId', label: 'Department', width: 'minmax(110px,1fr)', type: 'select', options: deptOptions },
              { key: 'grade', label: 'Grade', width: '56px', placeholder: 'G-7' },
            ]}
          />
        </Card>
        <Card className="self-start">
          <MasterList
            kind="departments"
            title={`Departments · ${departments.length}`}
            addLabel="Add department"
            addKind="o"
            nameKey="name"
            usageLabel="Staff"
            usageNoun="user"
            items={plain(departments)}
            cols={[
              { key: 'name', label: 'Name', width: 'minmax(110px,1.6fr)', bold: true, placeholder: 'Nursing' },
              { key: 'code', label: 'Code', width: '56px', placeholder: 'NUR' },
            ]}
          />
        </Card>
      </div>
    </AdminPage>
  )
}
