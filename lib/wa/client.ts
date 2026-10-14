import 'server-only'
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, type WASocket } from '@whiskeysockets/baileys'
import pino from 'pino'
import { WaAuth } from '../models'
import { mongoAuthState } from './auth-state'

// "Connect on demand": there is no always-on process on Vercel, so a function opens a WhatsApp Web
// session only while it has something to do (pairing, or sending the queued messages), then closes it.
// A lease in MongoDB makes sure two functions never open the same session at once (WhatsApp would
// kick one of them out).

const logger = pino({ level: 'silent' })

let versionCache: { at: number; version: [number, number, number] } | null = null
async function waVersion() {
  if (versionCache && Date.now() - versionCache.at < 6 * 3600_000) return versionCache.version
  try {
    const v = await fetchLatestBaileysVersion({ signal: AbortSignal.timeout(5000) } as RequestInit)
    versionCache = { at: Date.now(), version: v.version }
    return v.version
  } catch {
    return undefined
  }
}

/** Session lease. Returns null when another function holds it. */
export async function acquireLock(ttlMs = 70_000) {
  const now = new Date()
  const owner = Math.random().toString(36).slice(2)
  const row = await WaAuth.findOneAndUpdate({ _id: 'lock', $or: [{ until: { $lt: now } }, { until: null }] }, { $set: { owner, until: new Date(now.getTime() + ttlMs) } }, { upsert: true, new: true })
    .lean<any>()
    .catch(() => null) // duplicate-key on upsert = someone else holds a live lease
  if (!row || row.owner !== owner) return null
  return { release: async () => void (await WaAuth.updateOne({ _id: 'lock', owner }, { $set: { until: new Date(0) } })) }
}

export type Conn = { sock: WASocket; ready: Promise<'open' | 'paired'>; close: () => void }

/** Open one connection. `ready` resolves when the socket is open (or right after a successful QR scan). */
export async function connect(opts: { onQr?: (qr: string) => void; timeoutMs?: number } = {}): Promise<Conn> {
  const { state, saveCreds, clear } = await mongoAuthState()
  const sock = makeWASocket({
    version: await waVersion(),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    logger,
    browser: ['Unico HomeCare', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    shouldSyncHistoryMessage: () => false,
    connectTimeoutMs: 20_000,
    defaultQueryTimeoutMs: 20_000,
    keepAliveIntervalMs: 10_000,
  })
  let settle!: (v: 'open' | 'paired') => void
  let fail!: (e: Error) => void
  const ready = new Promise<'open' | 'paired'>((res, rej) => {
    settle = res
    fail = rej
  })
  ready.catch(() => {}) // observed by callers; avoid unhandled-rejection noise when they time out first
  const timer = setTimeout(() => fail(new Error('WhatsApp did not connect in time')), opts.timeoutMs ?? 25_000)
  sock.ev.on('creds.update', () => {
    saveCreds().catch(() => {})
  })
  sock.ev.on('connection.update', (u) => {
    if (u.qr) opts.onQr?.(u.qr)
    if (u.connection === 'open') {
      clearTimeout(timer)
      settle('open')
    }
    if (u.connection === 'close') {
      clearTimeout(timer)
      const code = (u.lastDisconnect?.error as any)?.output?.statusCode as number | undefined
      if (code === DisconnectReason.restartRequired && state.creds.me?.id) return settle('paired') // right after a QR scan
      if (code === DisconnectReason.loggedOut) {
        clear().catch(() => {})
        return fail(new Error('WhatsApp logged this device out — scan the QR again'))
      }
      fail(new Error(code === DisconnectReason.connectionReplaced ? 'Another connection is using this WhatsApp session' : `WhatsApp connection closed (${code ?? 'unknown'})`))
    }
  })
  const close = () => {
    clearTimeout(timer)
    try {
      sock.end(undefined)
    } catch {}
  }
  return { sock, ready, close }
}
