import 'server-only'
import type { WASocket } from '@whiskeysockets/baileys'
import { MessageLog } from '../models'
import { nextStatus, receiptOf, type Receipt } from './ticks'

// Delivered / read receipts. WhatsApp reports them only to a connected device — including the ones it held while we
// were away, right after we connect — so every connection (lib/wa/client.ts connect) listens, and the inbox can open a
// short receipt-only session (service.ts syncReceipts). A receipt only moves a message forward (lib/wa/ticks.ts).

let changed = 0
/** how many messages got a newer tick since the counter was last read (for "N ticks updated") */
export const takeChanged = () => {
  const n = changed
  changed = 0
  return n
}

export async function markReceipt(providerId: string, receipt: Receipt, at?: Date) {
  const m = await MessageLog.findOne({ channel: 'WHATSAPP', providerId }).select('status deliveredAt').lean<any>()
  if (!m) return
  const next = nextStatus(m.status, receipt)
  if (!next) return
  const when = at && !isNaN(+at) ? at : new Date()
  const set: Record<string, unknown> = { status: next }
  if (next === 'DELIVERED') set.deliveredAt = when
  if (next === 'OPENED') {
    set.readAt = when
    if (!m.deliveredAt) set.deliveredAt = when // read means it was delivered
  }
  const r = await MessageLog.updateOne({ _id: m._id, status: m.status }, { $set: set, $push: { events: { status: next, at: when, note: next === 'OPENED' ? 'Read' : 'Delivered' } } })
  if (r.modifiedCount) changed++
}

const tsDate = (t: unknown) => {
  const n = Number(typeof t === 'object' && t && 'toNumber' in (t as any) ? (t as any).toNumber() : t)
  return n > 0 ? new Date(n * 1000) : undefined
}

/** Listen on a socket for receipts of messages we sent. */
export function listenForReceipts(sock: WASocket) {
  sock.ev.on('messages.update', (updates) => {
    for (const u of updates) {
      const r = receiptOf((u.update as any)?.status)
      if (u.key?.fromMe && u.key.id && r) void markReceipt(u.key.id, r).catch(() => {})
    }
  })
  // per-recipient receipts with their real times (WhatsApp sends these too; also the only kind for groups)
  sock.ev.on('message-receipt.update', (updates) => {
    for (const u of updates as any[]) {
      if (!u?.key?.fromMe || !u.key.id) continue
      const read = tsDate(u.receipt?.readTimestamp) ?? tsDate(u.receipt?.playedTimestamp)
      const got = tsDate(u.receipt?.receiptTimestamp)
      if (read) void markReceipt(u.key.id, 'OPENED', read).catch(() => {})
      else if (got) void markReceipt(u.key.id, 'DELIVERED', got).catch(() => {})
    }
  })
}
