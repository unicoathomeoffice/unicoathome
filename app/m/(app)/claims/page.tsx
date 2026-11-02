import { MScreen } from '@/components/mobile'
import { ClaimsScreen } from '@/components/field/claims'
import { requireAppUser } from '@/lib/auth'
import { db, plain } from '@/lib/db'
import { ExpenseClaim, isOid } from '@/lib/models'
import { draftOf, suggestions } from '@/lib/services/claims'

export const metadata = { title: 'My claims' }

/** Travel / food / other expenses → the hospital's Bill Submission form, sent to the security supervisor. */
export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ visit?: string }> }) {
  const user = await requireAppUser()
  await db()
  const sp = await searchParams
  const [claim, suggest, history] = await Promise.all([draftOf(user), suggestions(user), ExpenseClaim.find({ userId: user.id, status: { $ne: 'DRAFT' } }).sort({ submittedAt: -1 }).limit(20).lean<any[]>()])
  return (
    <MScreen title="My claims" sub="Travel, food & other expenses" back="/m/profile">
      <ClaimsScreen initialClaim={plain(claim)} initialSuggestions={plain(suggest)} history={plain(history)} focusVisit={sp.visit && isOid(sp.visit) ? sp.visit : undefined} />
    </MScreen>
  )
}
