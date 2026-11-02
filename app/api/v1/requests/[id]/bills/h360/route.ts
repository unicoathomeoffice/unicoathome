import { z } from 'zod'
import { route, body, clientMeta, ApiError } from '@/lib/api'
import { H360Error } from '@/lib/h360'
import { loadRequest } from '@/lib/services/requests'
import { findH360Bills, importH360Bill } from '@/lib/services/h360-bills'

export const maxDuration = 60

/** GET /api/v1/requests/:id/bills/h360?q= — this patient's bills in H360 (or by invoice no / UHID), with paid / due. */
export const GET = route<{ id: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    try {
      return await findH360Bills(r, req.nextUrl.searchParams.get('q') ?? '')
    } catch (e) {
      if (e instanceof H360Error) return { uhid: '', bills: [], offline: true, code: e.code, error: e.message }
      throw e
    }
  },
  { perm: 'billing.invoice' },
)

const ImportInput = z.object({ invoiceNo: z.string().trim().regex(/^\d{4,7}$/, 'Enter the H360 invoice no'), otherPatient: z.boolean().optional() })

/** POST /api/v1/requests/:id/bills/h360 { invoiceNo } — add the H360 bill: bill copy PDF, items, live paid / due. */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    const input = await body(req, ImportInput)
    try {
      return await importH360Bill(r, input.invoiceNo, { otherPatient: input.otherPatient }, user, clientMeta(req, user))
    } catch (e) {
      if (e instanceof H360Error) throw new ApiError(502, `H360_${e.code}`, e.message)
      throw e
    }
  },
  { perm: 'billing.invoice' },
)
