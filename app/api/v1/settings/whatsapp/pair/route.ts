import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUser } from '@/lib/auth'
import { canOpenSettings } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { pairWhatsApp } from '@/lib/wa/service'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/settings/whatsapp/pair — server-sent events: {qr} images to scan, then {paired, phone} or {error}.
 * The session stays open for up to ~58 s while the admin scans with WhatsApp → Linked devices.
 */
export async function GET() {
  await db()
  const user = await getUser()
  if (!user || !canOpenSettings(user)) return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Not allowed' } }, { status: 403 })
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`))
      try {
        for await (const ev of pairWhatsApp()) {
          send(ev)
          if (ev.paired) await audit(user, 'settings.whatsapp_pair', 'settings', 'whatsapp', { after: { phone: ev.phone }, label: 'WhatsApp paired' })
        }
      } catch (e: any) {
        send({ error: String(e?.message ?? e) })
      } finally {
        send({ done: true })
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' } })
}
