import { requireWebUser } from '@/lib/auth'
import { db, plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { liveBoard } from '@/lib/services/tracking'
import { LiveBoard } from '@/components/request-detail/LiveBoard'

export const metadata = { title: 'Live map · Unico HomeCare' }

/** Every care team currently travelling — to a patient or back to the hospital — on one map. */
export default async function LivePage() {
  await requireWebUser('requests.readAll')
  await db()
  return (
    <AdminPage title="Live map" crumbs="Teams on the move">
      <LiveBoard initial={plain(await liveBoard())} />
    </AdminPage>
  )
}
