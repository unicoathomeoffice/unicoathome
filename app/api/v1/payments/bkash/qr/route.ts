import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUser } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { readFile } from '@/lib/files'

/** GET /api/v1/payments/bkash/qr — the hospital's bKash QR picture, as uploaded (signed-in staff: shown on the phone,
 *  or shared from it). */
export async function GET() {
  await db()
  if (!(await getUser())) return new NextResponse(null, { status: 401 })
  const id = (await getSettings()).payments.bkash.qrAttachmentId
  if (!id) return new NextResponse(null, { status: 404 })
  const f = await readFile(id)
  if (!f) return new NextResponse(null, { status: 404 })
  return new Response(new Uint8Array(f.data), { headers: { 'content-type': f.mime, 'cache-control': 'private, max-age=3600', 'content-disposition': `inline; filename="${f.filename}"` } })
}
