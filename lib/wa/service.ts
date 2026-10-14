import 'server-only'
import QRCode from 'qrcode'
import { MessageLog, WaAuth } from '../models'
import { background, waNumber } from '../messaging'
import { acquireLock, connect, type Conn } from './client'
import { isPaired, mongoAuthState, pairedPhone } from './auth-state'

// WhatsApp auto-send. Messages are rows in message_logs (channel WHATSAPP, provider wa_baileys) with
// status QUEUED; pumpWhatsApp() delivers them in one short connection. See lib/wa/client.ts.

const PROVIDER = 'wa_baileys'
const setMeta = (patch: Record<string, unknown>) => WaAuth.updateOne({ _id: 'meta' }, { $set: patch }, { upsert: true })
const getMeta = async () => (await WaAuth.findById('meta').lean<any>()) ?? {}

export async function waStatus() {
  const [paired, phone, m, queued, failed7d] = await Promise.all([
    isPaired(),
    pairedPhone(),
    getMeta(),
    MessageLog.countDocuments({ channel: 'WHATSAPP', provider: PROVIDER, status: 'QUEUED' }),
    MessageLog.countDocuments({ channel: 'WHATSAPP', provider: PROVIDER, status: 'FAILED', at: { $gte: new Date(Date.now() - 7 * 86400_000) } }),
  ])
  return { paired, phone, queued, failed7d, lastSentAt: m.lastSentAt ?? null, lastError: m.lastError ?? null, lastErrorAt: m.lastErrorAt ?? null, pairedAt: m.pairedAt ?? null }
}

/** Log a WhatsApp message and deliver it in the background. */
export async function queueWhatsApp(input: { to: string; toName?: string; text: string; templateKey?: string; requestId?: unknown; patientId?: unknown; initiatedBy?: string }) {
  const log = await MessageLog.create({
    channel: 'WHATSAPP',
    provider: PROVIDER,
    to: waNumber(input.to),
    toName: input.toName,
    templateKey: input.templateKey,
    renderedText: input.text,
    requestId: input.requestId,
    patientId: input.patientId,
    initiatedBy: input.initiatedBy,
    status: 'QUEUED',
    events: [{ status: 'QUEUED', at: new Date() }],
  })
  background(() => pumpWhatsApp())
  return log
}

/** Deliver queued messages in one short connection. Safe to call often: the lease keeps it to one session at a time. */
export async function pumpWhatsApp(max = 15): Promise<{ sent: number; failed: number; skipped?: string }> {
  if (!(await isPaired())) return { sent: 0, failed: 0, skipped: 'not paired' }
  if (!(await MessageLog.exists({ channel: 'WHATSAPP', provider: PROVIDER, status: 'QUEUED' }))) return { sent: 0, failed: 0, skipped: 'nothing queued' }
  const lock = await acquireLock()
  if (!lock) return { sent: 0, failed: 0, skipped: 'busy' }
  let sent = 0
  let failed = 0
  let conn: Conn | undefined
  try {
    conn = await connect({ timeoutMs: 25_000 })
    if ((await conn.ready) !== 'open') throw new Error('Connection did not open')
    const rows = await MessageLog.find({ channel: 'WHATSAPP', provider: PROVIDER, status: 'QUEUED' }).sort({ at: 1 }).limit(max)
    for (const m of rows) {
      try {
        const res = await conn.sock.sendMessage(`${m.to}@s.whatsapp.net`, { text: m.renderedText })
        m.status = 'SENT'
        m.providerId = res?.key?.id
        m.attempts = (m.attempts ?? 0) + 1
        m.events.push({ status: 'SENT', at: new Date() })
        await m.save()
        sent++
        await new Promise((r) => setTimeout(r, 400)) // gentle pacing
      } catch (e: any) {
        m.attempts = (m.attempts ?? 0) + 1
        m.error = String(e?.message ?? e).slice(0, 300)
        if (m.attempts >= 4) {
          m.status = 'FAILED'
          failed++
        }
        m.events.push({ status: m.status, at: new Date(), note: m.error })
        await m.save()
      }
    }
    await setMeta({ ...(sent ? { lastSentAt: new Date() } : {}), lastError: null })
    return { sent, failed }
  } catch (e: any) {
    await setMeta({ lastError: String(e?.message ?? e).slice(0, 300), lastErrorAt: new Date() })
    return { sent, failed, skipped: String(e?.message ?? e) }
  } finally {
    conn?.close()
    await lock.release()
  }
}

/** Pairing: yields QR images until the phone scans one (≈ 55 s window). Used by the SSE route. */
export async function* pairWhatsApp(): AsyncGenerator<{ qr?: string; paired?: boolean; phone?: string | null; error?: string }> {
  const lock = await acquireLock(65_000)
  if (!lock) {
    yield { error: 'WhatsApp is busy sending messages — try again in a minute' }
    return
  }
  const qrs: string[] = []
  let wake: (() => void) | null = null
  let finished: { r?: 'open' | 'paired'; e?: Error } | null = null
  let conn: Conn | undefined
  try {
    conn = await connect({
      timeoutMs: 58_000,
      onQr: (qr) => {
        qrs.push(qr)
        wake?.()
      },
    })
    conn.ready.then((r) => (finished = { r }), (e) => (finished = { e })).finally(() => wake?.())
    const started = Date.now()
    while (!finished && Date.now() - started < 58_000) {
      if (qrs.length) {
        const qr = qrs.pop()! // newest only
        qrs.length = 0
        yield { qr: await QRCode.toDataURL(qr, { margin: 1, width: 280 }) }
        continue
      }
      await new Promise<void>((res) => {
        wake = res
        setTimeout(res, 1000)
      })
    }
    const f = finished as { r?: 'open' | 'paired'; e?: Error } | null
    if (f?.r) {
      await setMeta({ pairedAt: new Date(), lastError: null })
      yield { paired: true, phone: await pairedPhone() }
    } else if (f?.e) yield { error: f.e.message }
    else yield { error: 'The QR expired — click Connect again' }
  } finally {
    conn?.close()
    await lock.release()
  }
}

/** Log the device out of WhatsApp (best effort) and forget the session. */
export async function unpairWhatsApp() {
  const lock = await acquireLock(30_000)
  try {
    if (await isPaired()) {
      try {
        const conn = await connect({ timeoutMs: 15_000 })
        if ((await conn.ready) === 'open') await conn.sock.logout()
        conn.close()
      } catch {}
    }
  } finally {
    await lock?.release()
  }
  await (await mongoAuthState()).clear()
  await setMeta({ pairedAt: null })
}
