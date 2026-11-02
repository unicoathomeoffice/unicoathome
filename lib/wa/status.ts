import 'server-only'
import { WaAuth } from '../models'

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
  const c = await creds()
  if (!c?.me?.id) return { state: 'not_paired' }
  const meta = (await WaAuth.findById('meta').lean<any>()) ?? {}
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

export async function pairedPhone(): Promise<string | null> {
  const c = await creds()
  return c?.me?.id ? String(c.me.id).split(':')[0].split('@')[0] : null
}
