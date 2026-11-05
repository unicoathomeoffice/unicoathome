import 'server-only'
import QRCode from 'qrcode'
import { MessageLog, WaAuth } from '../models'
import { background, stripRequestNo, waNumber } from '../messaging'
import { acquireLock, connect, type Conn } from './client'
import { isPaired, mongoAuthState, pairedPhone } from './auth-state'
import { linkState } from './status'
import { allowance, calmDown, checkFresh, contactState, inQuietHours, isDuplicate, isInternalAlert, isPushback, needsOptOutFooter, OPT_OUT_FOOTER, optOut, pausedUntil, priorityOf, rand, recipientRoom, rememberCheck, sleep, STOP_RX, tooLate, tripBreaker, typingMs } from './guard'

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
  const link = await linkState()
  return { paired, state: link.state, stateReason: link.reason ?? null, phone, queued, failed7d, lastSentAt: m.lastSentAt ?? null, lastError: m.lastError ?? null, lastErrorAt: m.lastErrorAt ?? null, pairedAt: m.pairedAt ?? null, verifiedAt: m.verifiedAt ?? null }
}

/** Log a WhatsApp message and deliver it in the background. With attachmentId the file is sent (PDF as a document,
 *  photo as an image) and `text` becomes its caption. Delivery follows the sending-safety rules (lib/wa/guard.ts). */
export async function queueWhatsApp(input: { to: string; toName?: string; text: string; templateKey?: string; requestId?: unknown; patientId?: unknown; initiatedBy?: string; attachmentId?: unknown; fileName?: string; priority?: number }) {
  input = { ...input, text: stripRequestNo(input.text ?? ''), fileName: input.fileName ? stripRequestNo(input.fileName).replace(/-+(?=\.)/, '') : undefined }
  const to = waNumber(input.to)
  const c = to ? await contactState(to) : null
  const blocked = !to ? 'No valid number' : c?.optOut ? 'Opted out (replied STOP)' : c?.exists === false && checkFresh(c) ? 'Not on WhatsApp' : null
  const log = await MessageLog.create({
    channel: 'WHATSAPP',
    provider: PROVIDER,
    to,
    toName: input.toName,
    templateKey: input.templateKey,
    renderedText: (input.text ?? '').slice(0, 1500),
    requestId: input.requestId,
    patientId: input.patientId,
    initiatedBy: input.initiatedBy,
    attachmentId: input.attachmentId,
    fileName: input.fileName,
    priority: input.priority ?? priorityOf(input.templateKey),
    status: blocked ? 'SKIPPED' : 'QUEUED',
    error: blocked ?? undefined,
    events: [{ status: blocked ? 'SKIPPED' : 'QUEUED', at: new Date(), note: blocked ?? undefined }],
  })
  if (!blocked) background(() => pumpSoon())
  return log
}

/** Wait a few seconds so the messages of one action go out in one session, and keep 20 s between sessions. */
async function pumpSoon() {
  await sleep(8_000)
  const meta = await getMeta()
  const gap = meta.lastSessionAt ? 20_000 - (Date.now() - new Date(meta.lastSessionAt).getTime()) : 0
  if (gap > 0) await sleep(Math.min(gap, 20_000))
  return pumpWhatsApp()
}

const fail = async (m: any, note: string, final = true) => {
  m.attempts = (m.attempts ?? 0) + 1
  m.error = note.slice(0, 300)
  if (final || m.attempts >= 4) m.status = 'FAILED'
  m.events.push({ status: m.status, at: new Date(), note: m.error })
  await m.save()
}

/** Deliver queued messages in one short connection, within the sending-safety limits. Messages over a limit, or
 *  routine ones during quiet hours, stay QUEUED for a later run. Safe to call often (one session at a time). */
export async function pumpWhatsApp(): Promise<{ sent: number; failed: number; skipped?: string }> {
  if (!(await isPaired())) return { sent: 0, failed: 0, skipped: 'not paired' }
  const paused = await pausedUntil()
  if (paused) return { sent: 0, failed: 0, skipped: `paused until ${paused.until.toISOString()}` }
  if (!(await MessageLog.exists({ channel: 'WHATSAPP', provider: PROVIDER, status: 'QUEUED' }))) return { sent: 0, failed: 0, skipped: 'nothing queued' }
  const room = await allowance()
  if (room.left <= 0) return { sent: 0, failed: 0, skipped: 'rate limit — will send later' }
  const quiet = await inQuietHours()
  // urgent first; routine automatic messages wait out quiet hours (anything sent by hand still goes)
  const rows = await MessageLog.find({ channel: 'WHATSAPP', provider: PROVIDER, status: 'QUEUED', ...(quiet ? { $or: [{ priority: { $gte: 10 } }, { initiatedBy: { $ne: null } }] } : {}) })
    .sort({ priority: -1, at: 1 })
    .limit(40)
  if (!rows.length) return { sent: 0, failed: 0, skipped: 'waiting for morning (quiet hours)' }
  const lock = await acquireLock(90_000)
  if (!lock) return { sent: 0, failed: 0, skipped: 'busy' }
  const cfg = room.cfg
  let sent = 0
  let failed = 0
  let inARow = 0
  let conn: Conn | undefined
  try {
    await setMeta({ lastSessionAt: new Date() })
    conn = await connect({ timeoutMs: 25_000 })
    if ((await conn.ready) !== 'open') throw new Error('Connection did not open')
    await setMeta({ verifiedAt: new Date(), needsRescan: null, needsRescanReason: null })
    const sock = conn.sock
    // STOP replies that arrive while we're connected (WhatsApp also delivers ones received while we were away)
    if (cfg.optOut)
      sock.ev.on('messages.upsert', ({ messages }) => {
        for (const msg of messages) {
          if (msg.key.fromMe || !msg.key.remoteJid?.endsWith('@s.whatsapp.net')) continue
          const text = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? ''
          if (!STOP_RX.test(text)) continue
          const n = msg.key.remoteJid.split('@')[0]
          optOut(n)
            .then(() => sock.sendMessage(msg.key.remoteJid!, { text: 'You will not get WhatsApp messages from Unico HomeCare any more. Call the hospital if you need us.' }))
            .catch(() => {})
        }
      })
    const started = Date.now()
    for (const m of rows) {
      if (sent >= room.left || Date.now() - started > 60_000) break // stay inside the limit and the lease
      if ((await contactState(m.to))?.optOut) {
        m.status = 'SKIPPED'
        m.events.push({ status: 'SKIPPED', at: new Date(), note: 'Opted out (replied STOP)' })
        await m.save()
        continue
      }
      const late = tooLate(m)
      if (late) {
        m.status = 'SKIPPED'
        m.events.push({ status: 'SKIPPED', at: new Date(), note: `Too late to send (waited over ${late} h — WhatsApp was not linked)` })
        await m.save()
        continue
      }
      if (await isDuplicate(m, cfg.dedupeMin)) {
        m.status = 'SKIPPED'
        m.events.push({ status: 'SKIPPED', at: new Date(), note: 'Duplicate of a message sent a few minutes ago' })
        await m.save()
        continue
      }
      if (!isInternalAlert(m.templateKey) && !(await recipientRoom(m.to, cfg))) continue // this person had enough for now: later
      const jid = `${m.to}@s.whatsapp.net`
      try {
        // only real WhatsApp numbers (messaging numbers that aren't on WhatsApp is a ban signal)
        if (cfg.checkNumbers) {
          const c = await contactState(m.to)
          if (!checkFresh(c)) {
            const [hit] = (await sock.onWhatsApp(jid)) ?? []
            await rememberCheck(m.to, !!hit?.exists)
            if (!hit?.exists) {
              await fail(m, 'Not on WhatsApp')
              failed++
              continue
            }
          } else if (c.exists === false) {
            await fail(m, 'Not on WhatsApp')
            failed++
            continue
          }
        }
        let text = m.renderedText ?? ''
        if (await needsOptOutFooter(m.to, m.patientId)) text += OPT_OUT_FOOTER
        let content: any = { text }
        if (m.attachmentId) {
          const { readFile } = await import('../files')
          const f = await readFile(m.attachmentId)
          if (!f) {
            await fail(m, 'The file to send no longer exists')
            failed++
            continue
          }
          content = f.mime.startsWith('image/') ? { image: f.data, caption: text, mimetype: f.mime } : { document: f.data, mimetype: f.mime, fileName: m.fileName || f.filename, caption: text }
        }
        if (cfg.typing) {
          await sock.presenceSubscribe(jid).catch(() => {})
          await sock.sendPresenceUpdate('composing', jid).catch(() => {})
          await sleep(typingMs(text))
          await sock.sendPresenceUpdate('paused', jid).catch(() => {})
        }
        const res = await sock.sendMessage(jid, content)
        m.status = 'SENT'
        m.sentAt = new Date()
        m.providerId = res?.key?.id
        m.attempts = (m.attempts ?? 0) + 1
        m.events.push({ status: 'SENT', at: new Date() })
        await m.save()
        sent++
        inARow = 0
        await sleep(rand(cfg.delayMinSec * 1000, cfg.delayMaxSec * 1000)) // human-like gap
      } catch (e: any) {
        const msg = String(e?.message ?? e)
        await fail(m, msg, false)
        if (m.status === 'FAILED') failed++
        inARow++
        if (isPushback(msg) || inARow >= 3) {
          await tripBreaker(isPushback(msg) ? `WhatsApp refused a message (${msg.slice(0, 80)})` : '3 messages in a row failed')
          break
        }
      }
    }
    if (sent && !inARow) await calmDown()
    await setMeta({ ...(sent ? { lastSentAt: new Date() } : {}), lastError: null })
    return { sent, failed }
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    await setMeta({ lastError: msg.slice(0, 300), lastErrorAt: new Date() })
    await markIfLoggedOut(msg)
    if (/logged this device out/i.test(msg)) await tripBreaker('WhatsApp logged this device out — scan the QR again')
    return { sent, failed, skipped: msg }
  } finally {
    conn?.close()
    await lock.release()
  }
}

/**
 * Pairing. Yields QR images (or, with `phone`, an 8-character code for "Link with phone number") until the phone
 * links. After the scan WhatsApp closes the socket with "restart required" and the companion must reconnect AT ONCE
 * with the new credentials to finish the login — otherwise the phone gives up with "Couldn't log in". So we reconnect,
 * wait for the connection to open (device keys get stored), and only then report success.
 */
export async function* pairWhatsApp(opts: { phone?: string } = {}): AsyncGenerator<{ qr?: string; code?: string; paired?: boolean; phone?: string | null; error?: string; note?: string }> {
  const lock = await acquireLock(115_000)
  if (!lock) {
    yield { error: 'WhatsApp is busy sending messages — try again in a minute' }
    return
  }
  const qrs: string[] = []
  let wake: (() => void) | null = null
  let finished: { r?: 'open' | 'paired'; e?: Error } | null = null
  let conn: Conn | undefined
  let code: string | null = null
  let codeErr: string | null = null
  try {
    // a fresh start: a half-finished earlier link must not be reused
    const { clear } = await mongoAuthState()
    await clear()
    await setMeta({ needsRescan: null, needsRescanReason: null, verifiedAt: null })
    conn = await connect({
      timeoutMs: 60_000,
      onQr: (qr) => {
        qrs.push(qr)
        wake?.()
      },
      onSocket: (sock) => {
        const phone = opts.phone ? waNumber(opts.phone) : ''
        if (!phone) return
        // the code can be asked for once the socket is up (WhatsApp sends the first QR at that moment)
        setTimeout(() => {
          sock
            .requestPairingCode(phone)
            .then((c) => {
              code = c
              wake?.()
            })
            .catch((e) => {
              codeErr = String(e?.message ?? e)
              wake?.()
            })
        }, 2500)
      },
    })
    conn.ready.then((r) => (finished = { r }), (e) => (finished = { e })).finally(() => wake?.())
    const started = Date.now()
    let codeSent = false
    while (!finished && Date.now() - started < 60_000) {
      if (opts.phone) {
        if (code && !codeSent) {
          codeSent = true
          yield { code: String(code).replace(/(.{4})(.{4})/, '$1-$2') }
          continue
        }
        if (codeErr) {
          yield { error: `Could not get a code for this number (${codeErr})` }
          return
        }
        qrs.length = 0 // phone-number mode: no QR
      } else if (qrs.length) {
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
    if (!f?.r) {
      yield { error: f?.e?.message ?? (opts.phone ? 'The code expired — try again' : 'The QR expired — click Connect again') }
      return
    }
    if (f.r === 'paired') {
      // finish the login: reconnect straight away with the credentials the scan just gave us
      yield { note: 'Scanned — finishing the link on your phone…' }
      conn.close()
      await new Promise((r) => setTimeout(r, 1500)) // the scan's credentials are saved asynchronously (creds.update)
      conn = await connect({ timeoutMs: 45_000 })
      const second = await conn.ready.catch((e: Error) => e)
      if (second !== 'open') {
        await clear()
        yield { error: `Linking didn't finish (${second instanceof Error ? second.message : 'no connection'}) — scan again` }
        return
      }
    }
    await new Promise((r) => setTimeout(r, 3000)) // let WhatsApp take the device keys before we close
    await setMeta({ pairedAt: new Date(), verifiedAt: new Date(), needsRescan: null, needsRescanReason: null, lastError: null })
    yield { paired: true, phone: await pairedPhone() }
  } finally {
    conn?.close()
    await lock.release()
  }
}

/** Open a session for a moment to confirm the link still works (Settings → Check connection). */
export async function checkWhatsApp(): Promise<{ ok: boolean; error?: string }> {
  const lock = await acquireLock(40_000)
  if (!lock) return { ok: false, error: 'WhatsApp is busy sending — try again in a minute' }
  let conn: Conn | undefined
  try {
    conn = await connect({ timeoutMs: 25_000 })
    const r = await conn.ready
    if (r !== 'open') throw new Error('Connection did not open')
    await setMeta({ verifiedAt: new Date(), needsRescan: null, needsRescanReason: null, lastError: null })
    return { ok: true }
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    await markIfLoggedOut(msg)
    await setMeta({ lastError: msg.slice(0, 300), lastErrorAt: new Date() })
    return { ok: false, error: msg }
  } finally {
    conn?.close()
    await lock.release()
  }
}

/** WhatsApp logged the device out / refused it: the link is gone, show "Needs re-scan" instead of Connected. */
async function markIfLoggedOut(msg: string) {
  if (/logged this device out|loggedOut|401|not-authorized|device removed|Connection Failure/i.test(msg)) await setMeta({ needsRescan: true, needsRescanReason: msg.slice(0, 200) })
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
