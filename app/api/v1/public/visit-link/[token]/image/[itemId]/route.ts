import { NextResponse } from 'next/server'
import { publicRoute } from '@/lib/api'
import { Equipment, isOid } from '@/lib/models'
import { readFile } from '@/lib/files'
import { checkLink, deviceCookie } from '@/lib/services/staff-links'

/** GET — a bag item's picture for the no-login staff link (only for a verified phone on a valid link). */
export const GET = publicRoute<{ token: string; itemId: string }>(async ({ req, params }) => {
  if (!isOid(params.itemId)) return new NextResponse(null, { status: 404 })
  const probe = await checkLink(params.token)
  if (!probe.ok) return new NextResponse(null, { status: 404 })
  const c = await checkLink(params.token, req.cookies.get(deviceCookie(probe.link))?.value)
  if (!c.ok || !c.verified) return new NextResponse(null, { status: 401 })
  // only items in this visit's bag
  if (!(c.r.visit?.kit ?? []).some((k: any) => String(k.itemId) === params.itemId)) return new NextResponse(null, { status: 404 })
  const item = await Equipment.findById(params.itemId).select('imageId').lean<any>()
  const f = item?.imageId ? await readFile(item.imageId) : null
  if (!f) return new NextResponse(null, { status: 404 })
  return new NextResponse(new Uint8Array(f.data), { headers: { 'content-type': f.mime, 'cache-control': 'private, max-age=3600' } })
})
