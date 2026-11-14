// Turn a WhatsApp (Baileys) message into what the inbox stores. Pure — no imports — so it can be tested on its own.
//   chat key `to`: phone digits for a person · `g:<id>` for a group · `lid:<id>` when WhatsApp hides the number

export type InKind = 'text' | 'image' | 'document' | 'voice' | 'video' | 'sticker' | 'location' | 'contact' | 'other'
export type Parsed =
  | { type: 'ignore' }
  | { type: 'reaction'; target: string; emoji: string; by: string }
  | { type: 'revoke'; target: string }
  | {
      type: 'message'
      id: string
      to: string // chat key
      fromMe: boolean
      isGroup: boolean
      from: string | null // group: who wrote it (key)
      fromName: string | null // their WhatsApp name
      kind: InKind
      text: string
      media: null | { kind: 'image' | 'document'; mime: string; fileName: string | null; size: number }
      at: Date
    }

const digits = (s: string) => s.replace(/\D/g, '')
/** jid → chat key */
export function keyOf(jid?: string | null, alt?: string | null): string | null {
  if (!jid) return null
  const [user, server] = jid.split('@')
  const id = user.split(':')[0]
  if (server === 'g.us') return `g:${id}`
  if (server === 's.whatsapp.net' || server === 'c.us') return digits(id)
  if (server === 'lid') {
    if (alt && /@s\.whatsapp\.net$/.test(alt)) return digits(alt.split('@')[0].split(':')[0])
    return `lid:${id}`
  }
  return null // broadcast, newsletter, call…
}
/** chat key → jid (for sending) */
export function jidOf(key: string) {
  if (key.startsWith('g:')) return `${key.slice(2)}@g.us`
  if (key.startsWith('lid:')) return `${key.slice(4)}@lid`
  return `${digits(key)}@s.whatsapp.net`
}
export const isSpecialKey = (key: string) => key.startsWith('g:') || key.startsWith('lid:')

const tsDate = (t: unknown) => {
  const n = Number(typeof t === 'object' && t && 'toNumber' in (t as any) ? (t as any).toNumber() : t)
  return n > 0 ? new Date(n * 1000) : new Date()
}

/** Unwrap ephemeral / view-once / edited wrappers to the real content. */
function inner(m: any): any {
  let c = m
  for (let i = 0; i < 4 && c; i++) {
    const next = c.ephemeralMessage?.message ?? c.viewOnceMessage?.message ?? c.viewOnceMessageV2?.message ?? c.viewOnceMessageV2Extension?.message ?? c.documentWithCaptionMessage?.message ?? c.editedMessage?.message
    if (!next) break
    c = next
  }
  return c
}

export function parseIncoming(msg: any): Parsed {
  const k = msg?.key ?? {}
  const jid: string | undefined = k.remoteJid
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) return { type: 'ignore' }
  const to = keyOf(jid, k.remoteJidAlt)
  if (!to || !k.id) return { type: 'ignore' }
  const c = inner(msg.message)
  if (!c) return { type: 'ignore' }
  const isGroup = to.startsWith('g:')
  const sender = isGroup ? keyOf(k.participantAlt ?? k.participant, k.participantAlt) : to

  if (c.reactionMessage?.key?.id) return { type: 'reaction', target: c.reactionMessage.key.id, emoji: String(c.reactionMessage.text ?? ''), by: (k.fromMe ? 'me' : sender) ?? to }
  if (c.protocolMessage) {
    // 0 = REVOKE ("This message was deleted"); other protocol messages (keys, history, settings) are noise
    if ((c.protocolMessage.type ?? 0) === 0 && c.protocolMessage.key?.id) return { type: 'revoke', target: c.protocolMessage.key.id }
    return { type: 'ignore' }
  }

  let kind: InKind = 'other'
  let text = ''
  let media: Extract<Parsed, { type: 'message' }>['media'] = null
  if (c.conversation || c.extendedTextMessage?.text) {
    kind = 'text'
    text = c.conversation ?? c.extendedTextMessage.text
  } else if (c.imageMessage) {
    kind = 'image'
    text = c.imageMessage.caption ?? ''
    media = { kind: 'image', mime: c.imageMessage.mimetype ?? 'image/jpeg', fileName: null, size: Number(c.imageMessage.fileLength ?? 0) }
  } else if (c.documentMessage) {
    kind = 'document'
    text = c.documentMessage.caption ?? ''
    media = { kind: 'document', mime: c.documentMessage.mimetype ?? 'application/octet-stream', fileName: c.documentMessage.fileName ?? c.documentMessage.title ?? 'document', size: Number(c.documentMessage.fileLength ?? 0) }
  } else if (c.audioMessage) {
    kind = 'voice'
    text = c.audioMessage.ptt ? '🎤 Voice note — listen on the phone' : '🎵 Audio — listen on the phone'
  } else if (c.videoMessage) {
    kind = 'video'
    text = c.videoMessage.caption ? `🎬 Video — watch on the phone\n${c.videoMessage.caption}` : '🎬 Video — watch on the phone'
  } else if (c.stickerMessage) {
    kind = 'sticker'
    text = 'Sticker'
  } else if (c.locationMessage || c.liveLocationMessage) {
    const l = c.locationMessage ?? c.liveLocationMessage
    kind = 'location'
    text = `📍 ${l.name || l.address || 'Location'}\nhttps://maps.google.com/?q=${l.degreesLatitude},${l.degreesLongitude}`
  } else if (c.contactMessage || c.contactsArrayMessage) {
    kind = 'contact'
    const names = c.contactMessage ? [c.contactMessage.displayName] : (c.contactsArrayMessage.contacts ?? []).map((x: any) => x.displayName)
    text = `👤 Contact: ${names.filter(Boolean).join(', ') || 'shared contact'}`
  } else if (c.pollCreationMessage || c.pollCreationMessageV3) {
    const p = c.pollCreationMessage ?? c.pollCreationMessageV3
    kind = 'other'
    text = `📊 Poll: ${p.name ?? ''}`
  } else {
    return { type: 'ignore' } // calls, key exchanges, empty stubs…
  }
  return { type: 'message', id: k.id, to, fromMe: !!k.fromMe, isGroup, from: isGroup ? sender : null, fromName: k.fromMe ? null : msg.pushName ?? null, kind, text: String(text).slice(0, 4000), media, at: tsDate(msg.messageTimestamp) }
}
