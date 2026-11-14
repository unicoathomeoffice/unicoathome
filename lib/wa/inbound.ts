import 'server-only'
import sharp from 'sharp'
import { downloadMediaMessage, type WASocket } from '@whiskeysockets/baileys'
import { MessageLog } from '../models'
import { storeFile } from '../files'
import { audit } from '../audit'
import { parseIncoming } from './inbound-parse'

// Incoming WhatsApp (the inbox is a full WhatsApp Web): every connection records what WhatsApp hands over — messages
// people sent us (people and groups), messages typed on the linked phone itself, reactions and deletions. Photos and
// documents are saved (≤ 10 MB); voice notes / videos are noted. Nothing is ever sent back automatically and no read
// receipts go out, so people never see "read" just because the app collected their message.

const MAX_MEDIA = 10 * 1024 * 1024
const pending = new Set<Promise<unknown>>()
let saved = 0
const groupNames = new Map<string, string>()

/** Wait (up to `ms`) for messages still being saved — call before closing a session. */
export async function settleInbound(ms = 8_000) {
  if (!pending.size) return
  await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, ms))])
}

/** After a session: one audit + one admin notification when new messages came in. */
export async function finishInbound() {
  const n = saved
  saved = 0
  if (!n) return 0
  await audit(null, 'whatsapp.inbound', 'message', null, { after: { count: n } }).catch(() => {})
  const { notifyRoles } = await import('../messaging')
  await notifyRoles(['HC_ADMIN', 'SUPER_ADMIN'], { type: 'SYSTEM', title: `${n} new WhatsApp message${n === 1 ? '' : 's'}`, body: 'Open WhatsApp to read and reply', url: '/outbox' }).catch(() => {})
  return n
}

async function groupName(sock: WASocket, key: string) {
  if (groupNames.has(key)) return groupNames.get(key)!
  const known = (await MessageLog.findOne({ channel: 'WHATSAPP', to: key, toName: { $nin: [null, ''] } }).sort({ at: -1 }).select('toName').lean<any>())?.toName
  let name = known as string | undefined
  if (!name) name = (await sock.groupMetadata(`${key.slice(2)}@g.us`).catch(() => null))?.subject ?? undefined
  if (name) groupNames.set(key, name)
  return name ?? 'WhatsApp group'
}

async function saveMedia(sock: WASocket, msg: any, media: { kind: 'image' | 'document'; mime: string; fileName: string | null; size: number }) {
  if (media.size > MAX_MEDIA) return { note: `too large to save (${Math.round(media.size / 1048576)} MB) — open on the phone` }
  try {
    let data = (await downloadMediaMessage(msg, 'buffer', {}, { logger: undefined as any, reuploadRequest: sock.updateMediaMessage })) as Buffer
    let mime = media.mime
    let filename = media.fileName ?? `whatsapp-${msg.key.id}`
    if (media.kind === 'image') {
      data = await sharp(data).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
      mime = 'image/webp'
      filename = `whatsapp-${msg.key.id}.webp`
    }
    if (data.length > MAX_MEDIA) return { note: 'too large to save — open on the phone' }
    const a = await storeFile({ data, mime, filename, kind: 'WHATSAPP', ownerType: 'CHAT' })
    return { attachmentId: a._id, fileName: filename, mime }
  } catch {
    return { note: 'could not be downloaded — open on the phone' }
  }
}

async function handle(sock: WASocket, msg: any) {
  const p = parseIncoming(msg)
  if (p.type === 'ignore') return
  if (p.type === 'reaction') {
    await MessageLog.updateOne({ channel: 'WHATSAPP', providerId: p.target }, { $pull: { reactions: { by: p.by } } })
    if (p.emoji) await MessageLog.updateOne({ channel: 'WHATSAPP', providerId: p.target }, { $push: { reactions: { by: p.by, emoji: p.emoji, at: new Date() } } })
    return
  }
  if (p.type === 'revoke') {
    await MessageLog.updateOne({ channel: 'WHATSAPP', providerId: p.target }, { $set: { deletedAt: new Date() } })
    return
  }
  // our own app's messages echo back before the sender has stored their id: give it a moment, then check
  if (p.fromMe) await new Promise((r) => setTimeout(r, 4_000))
  // already known (our own app sent it, or saved in an earlier session)
  if (await MessageLog.exists({ channel: 'WHATSAPP', providerId: p.id })) return
  const chatName = p.isGroup ? await groupName(sock, p.to) : p.fromMe ? null : p.fromName
  const file = p.media ? await saveMedia(sock, msg, p.media) : null
  const label = p.media?.kind === 'image' ? '📷 Photo' : p.media?.kind === 'document' ? `📄 ${p.media.fileName ?? 'Document'}` : ''
  const text = file && 'note' in file ? [`${label} — ${file.note}`, p.text].filter(Boolean).join('\n') : p.text
  const base = {
    channel: 'WHATSAPP',
    provider: 'wa_baileys',
    to: p.to,
    ...(chatName ? { toName: chatName } : {}),
    renderedText: text,
    providerId: p.id,
    kind: p.kind,
    isGroup: p.isGroup,
    at: p.at,
    events: [{ status: p.fromMe ? 'SENT' : 'RECEIVED', at: p.at, note: p.fromMe ? 'Sent from the phone' : undefined }],
    ...(file && 'attachmentId' in file ? { attachmentId: file.attachmentId, fileName: file.fileName, mime: file.mime } : {}),
  }
  if (p.fromMe) {
    await MessageLog.updateOne({ channel: 'WHATSAPP', providerId: p.id }, { $setOnInsert: { ...base, direction: 'OUT', origin: 'PHONE', status: 'SENT', sentAt: p.at } }, { upsert: true })
    return
  }
  const r = await MessageLog.updateOne(
    { channel: 'WHATSAPP', providerId: p.id },
    { $setOnInsert: { ...base, direction: 'IN', status: 'RECEIVED', ...(p.isGroup ? { from: p.from, fromName: p.fromName } : {}) } },
    { upsert: true },
  )
  if (r.upsertedCount) saved++
}

/** Listen on a socket for incoming messages (people and groups), phone-typed messages, reactions and deletions. */
export function listenForInbound(sock: WASocket) {
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return
    for (const msg of messages) {
      const job = handle(sock, msg).catch(() => {})
      pending.add(job)
      job.finally(() => pending.delete(job))
    }
  })
}
