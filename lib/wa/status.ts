import 'server-only'
import { WaAuth } from '../models'

// Pairing status without touching Baileys. `auth-state.ts` / `client.ts` pull in @whiskeysockets/baileys + pino
// (seconds of cold start), so anything that only needs to know "is WhatsApp paired?" — the request lifecycle,
// the request detail page — reads the creds row here instead. `me.id` is a plain string, no Buffer reviver needed.

async function creds(): Promise<any> {
  const row = await WaAuth.findById('creds').lean<any>()
  return row?.value ? JSON.parse(row.value) : null
}

export async function isPaired() {
  const c = await creds()
  return !!c?.me?.id
}

export async function pairedPhone(): Promise<string | null> {
  const c = await creds()
  return c?.me?.id ? String(c.me.id).split(':')[0].split('@')[0] : null
}
