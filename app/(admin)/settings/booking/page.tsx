import { requireWebUser } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { availability } from '@/lib/booking'
import { AdminPage } from '@/components/admin/AdminPage'
import { BookingSettings, BookingBoard } from '@/components/admin-settings/BookingClient'

export const metadata = { title: 'Online booking · Unico HomeCare' }

/** Online booking control: slot rules for the public home page + a live board to block / unblock slots. */
export default async function BookingPage() {
  await requireWebUser('requests.manage')
  const s = await getSettings()
  const days = await availability(s.booking, { days: Math.min(Number(s.booking.daysAhead) || 14, 14) })
  return (
    <AdminPage title="Online booking" crumbs="Settings">
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <BookingSettings initial={JSON.parse(JSON.stringify(s.booking))} />
        <BookingBoard days={days} cfg={JSON.parse(JSON.stringify(s.booking))} />
      </div>
    </AdminPage>
  )
}
