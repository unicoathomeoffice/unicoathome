import { Suspense } from 'react'
import { requireAppUser } from '@/lib/auth'
import { HomecareRequest } from '@/lib/models'
import { getSettings } from '@/lib/settings'
import { LiveShare } from '@/components/field/LiveShare'
import { teamFilter } from '@/components/field/data'
import { WaReviewProvider } from '@/components/client/WaReview'
import { can } from '@/lib/constants'

/** Field app frame: phone-width column centred on larger screens. */
export default async function MobileLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAppUser()
  // coordinators on the phone approve WhatsApp too: "Review & send" opens after a click that created messages
  const review = can(user, 'messages.approve') && (await getSettings()).whatsapp.approval !== 'OFF'
  return (
    <div className="min-h-dvh bg-slate-200/60">
      {review && <WaReviewProvider overlay />}
      <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-slate-100 shadow-[0_0_0_1px_rgba(15,23,42,.06)]">
        <Suspense fallback={null}>
          <ActiveTrip />
        </Suspense>
        {children}
      </div>
    </div>
  )
}

/** Live location keeps going on every screen of the app while this user's trip is active (layout = never remounted
 *  by navigation; router.refresh() after Start journey / check-in / check-out updates it). */
async function ActiveTrip() {
  const user = await requireAppUser()
  const s = await getSettings()
  if (!s.features.liveTracking) return null
  const trip = await HomecareRequest.findOne({ 'tracking.active': true, deletedAt: null, ...teamFilter(user) })
    .sort({ 'tracking.startedAt': -1 })
    .select('_id tracking.phase')
    .lean<any>()
  if (!trip) return null
  return (
    <div className="sticky top-0 z-30">
      <LiveShare key={`${trip._id}-${trip.tracking.phase}`} requestId={String(trip._id)} phase={trip.tracking.phase} compact />
    </div>
  )
}
