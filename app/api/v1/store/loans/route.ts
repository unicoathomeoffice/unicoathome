import { route, body, clientMeta } from '@/lib/api'
import { createLoan, listLoans, loanBalances, loanPartners, LoanInput } from '@/lib/services/store-loans'

/** GET ?status=open|overdue|closed&direction=TAKEN|GIVEN&partner= — loans, balance per partner, partner names used. */
export const GET = route(
  async ({ req }) => {
    const q = req.nextUrl.searchParams
    const [items, balances, partners] = await Promise.all([listLoans({ status: q.get('status') ?? undefined, direction: q.get('direction') ?? undefined, partner: q.get('partner') ?? undefined }), loanBalances(), loanPartners()])
    return { items, balances, partners }
  },
  { perm: 'store.manage' },
)

/** POST { direction: TAKEN | GIVEN, partner: { kind, name, phone?, userId? }, items: [{ itemId, qty }], dueAt?, note?, requestNo? } */
export const POST = route(async ({ req, user }) => createLoan(await body(req, LoanInput), user, clientMeta(req, user)), { perm: 'store.manage' })
