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
import { LoanList } from '@/components/store/LoanList'
import { MovesList } from '@/components/store/MovesList'
import { listLoans, loanBalances, loansByItem } from '@/lib/services/store-loans'
import { StoreLoan } from '@/lib/models'

export const metadata = { title: 'Store · Family Medicine' }

/** The Family Medicine store: items with stock grouped by family (sizes & companies), and consumption entered by hand. */
export default async function StorePage({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string; reason?: string; status?: string; direction?: string; partner?: string }> }) {
  const user = await requireWebUser()
  if (!can(user, 'requests.manage') && !can(user, 'store.manage')) redirect('/dashboard?denied=1')
  const sp = await searchParams
  const manage = can(user, 'store.manage')
  const tab = manage && (sp.tab === 'consumption' || sp.tab === 'h360' || sp.tab === 'loans' || sp.tab === 'moves') ? sp.tab : 'items'
  const openLoans = manage ? await StoreLoan.countDocuments({ status: { $in: ['OPEN', 'PARTLY_RETURNED'] } }) : 0
  const last = manage ? await Setting.findOne({ key: 'store:lastCompare' }).lean<any>() : null
  const items = await Equipment.find({}).sort(MASTER.equipment.sort).lean<any[]>()
  const tabs = [
    { key: 'items', label: 'Items & stock', href: '/store' },
    ...(manage
      ? [
          { key: 'loans', label: 'Loans', href: '/store?tab=loans&status=open', count: openLoans || undefined },
          { key: 'h360', label: 'H360 match', href: '/store?tab=h360', count: last?.value?.differences ?? undefined },
          { key: 'consumption', label: 'Consumption', href: '/store?tab=consumption' },
          { key: 'moves', label: 'Movements', href: '/store?tab=moves' },
        ]
      : []),
  ]
  if (tab === 'moves') {
    return (
      <AdminPage title="Store" crumbs="Nursing Services – Family Medicine · every stock movement">
        <Tabs items={tabs} active={tab} className="mb-4" />
        <MovesList items={items.map((i) => ({ _id: String(i._id), name: i.name }))} />
      </AdminPage>
    )
  }
  if (tab === 'loans') {
    const filter = { status: sp.status ?? 'open', direction: sp.direction ?? '', partner: sp.partner ?? '' }
    const [rows, balances] = await Promise.all([listLoans(filter), loanBalances()])
    return (
      <AdminPage title="Store" crumbs="Nursing Services – Family Medicine · loans taken and given">
        <Tabs items={tabs} active={tab} className="mb-4" />
        <LoanList rows={rows} balances={balances} items={plain(items.filter((i) => i.isActive !== false))} filter={filter} canManage={manage} />
      </AdminPage>
    )
  }
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
  const [use, loans] = await Promise.all([MASTER.equipment.usage!(items.map((i) => i._id)), loansByItem()])
  for (const i of items) {
    i.inUse = use[String(i._id)] ?? 0
    const l = loans.get(String(i._id))
    if (l) Object.assign(i, l) // lentOut · borrowed
  }
  return (
    <AdminPage title="Store" crumbs="Nursing Services – Family Medicine · equipment & consumables">
      {tabs.length > 1 && <Tabs items={tabs} active={tab} className="mb-4" />}
      <EquipmentEditor items={plain(items)} canEdit={can(user, 'master.manage')} canStock={manage} />
    </AdminPage>
  )
}
