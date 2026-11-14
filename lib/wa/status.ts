import 'server-only'
import { MessageLog, WaAuth } from '../models'

// Pairing status without touching Baileys. `auth-state.ts` / `client.ts` pull in @whiskeysockets/baileys + pino
// (seconds of cold start), so anything that only needs to know "is WhatsApp paired?" — the request lifecycle,
// the request detail page — reads the creds row here instead. `me.id` is a plain string, no Buffer reviver needed.

async function creds(): Promise<any> {
  const row = await WaAuth.findById('creds').lean<any>()
  return row?.value ? JSON.parse(row.value) : null
}

/** Linked and usable: credentials with a phone, the link was completed (device keys stored or a verified
 *  connection) and nothing has asked for a re-scan since. A half-finished QR scan is NOT paired. */
export async function isPaired() {
  return (await linkState()).state === 'connected'
}

export type LinkState = { state: 'connected' | 'needs_rescan' | 'not_paired'; reason?: string | null }
export async function linkState(): Promise<LinkState> {
  // both rows at once (one round trip instead of two on every page that checks WhatsApp)
  const [c, m] = await Promise.all([creds(), WaAuth.findById('meta').lean<any>()])
  if (!c?.me?.id) return { state: 'not_paired' }
  const meta = m ?? {}
  if (meta.needsRescan) return { state: 'needs_rescan', reason: meta.needsRescanReason ?? 'WhatsApp asked to link the device again' }
  if (meta.verifiedAt) return { state: 'connected' }
  // sessions linked before verification existed: completed links have their signal keys stored
  const keys = await WaAuth.countDocuments({ _id: { $nin: ['meta', 'creds', 'lock'] } })
  return keys > 0 ? { state: 'connected' } : { state: 'needs_rescan', reason: 'The last QR scan did not finish linking' }
}

/**
 * A hospital number has been linked (working now, or waiting for a re-scan): messages may be QUEUED and they go out
 * as soon as the link works again (the sweep pumps the queue). Never-linked → nothing to queue for.
 * Senders use this, not isPaired(), so a requisition made while WhatsApp needed a re-scan is not silently dropped.
 */
export async function canQueue() {
  return (await linkState()).state !== 'not_paired'
}

/** Settings → WhatsApp card: link, queue and last activity — without loading Baileys (moved here from service.ts). */
export async function waStatus() {
  const [link, phone, m, queued, failed7d] = await Promise.all([
    linkState(),
    pairedPhone(),
    WaAuth.findById('meta').lean<any>().then((x) => x ?? {}),
    MessageLog.countDocuments({ channel: 'WHATSAPP', provider: 'wa_baileys', status: 'QUEUED' }),
    MessageLog.countDocuments({ channel: 'WHATSAPP', provider: 'wa_baileys', status: 'FAILED', at: { $gte: new Date(Date.now() - 7 * 86400_000) } }),
  ])
  return { paired: link.state === 'connected', state: link.state, stateReason: link.reason ?? null, phone, queued, failed7d, lastSentAt: m.lastSentAt ?? null, lastError: m.lastError ?? null, lastErrorAt: m.lastErrorAt ?? null, pairedAt: m.pairedAt ?? null, verifiedAt: m.verifiedAt ?? null }
}

export async function pairedPhone(): Promise<string | null> {
  const c = await creds()
  return c?.me?.id ? String(c.me.id).split(':')[0].split('@')[0] : null
}
