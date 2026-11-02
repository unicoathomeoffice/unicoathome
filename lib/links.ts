import 'server-only'
import { randomBytes } from 'node:crypto'
import { db } from './db'
import { ShortLink } from './models'

/** The public origin used in every link we send (no trailing slash). */
export function baseUrl() {
  const env = process.env.APP_BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
  return env.replace(/\/+$/, '')
}

export type LinkKind = 'TRACK' | 'FEEDBACK' | 'REQUEST' | 'REPORT' | 'LOGIN' | 'DASHBOARD' | 'JOIN' | 'OTHER'

/** What a link preview (WhatsApp, Facebook…) shows for each kind of short link. Never patient details. */
export const LINK_PREVIEW: Record<LinkKind, { title: string; description: string }> = {
  TRACK: { title: 'Your Unico HomeCare team is on the way', description: 'Follow the visiting team live on the map until they reach your home.' },
  FEEDBACK: { title: 'How was your home visit?', description: 'Tell Unico HomeCare about your visit — it takes less than a minute.' },
  REQUEST: { title: 'Home care request · Unico HomeCare', description: 'Open the request in the Unico HomeCare staff app.' },
  REPORT: { title: 'Visit report · Unico HomeCare', description: 'The report of a home care visit by Unico Hospitals Family Medicine.' },
  LOGIN: { title: 'Sign in · Unico HomeCare', description: 'Staff sign-in for Unico HomeCare.' },
  DASHBOARD: { title: 'Dashboard · Unico HomeCare', description: 'Today’s home care requests, visits and alerts.' },
  JOIN: { title: 'Join Unico HomeCare', description: 'Create your staff account for Unico Hospitals home care.' },
  OTHER: { title: 'Unico HomeCare', description: 'Doctors, nurses, physiotherapy and lab tests at home in Dhaka — Unico Hospitals Family Medicine.' },
}

const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ' // no 0/O, 1/l/I look-alikes
const code = (n = 7) => Array.from(randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('')

type Opts = { kind?: LinkKind; requestId?: unknown; ttlDays?: number }

/**
 * Short public link (`https://…/s/k3P9xQa`) for an app path. The same path always gets the same code while it lives,
 * so templates can be rendered many times without piling up rows. Falls back to the long URL if the DB write fails.
 */
export async function shortLink(target: string, o: Opts = {}): Promise<string> {
  const base = baseUrl()
  try {
    await db()
    const now = new Date()
    const hit = await ShortLink.findOne({ target, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] }).select('_id').lean<{ _id: string }>()
    if (hit) return `${base}/s/${hit._id}`
    const expiresAt = o.ttlDays ? new Date(now.getTime() + o.ttlDays * 86400_000) : undefined
    for (let i = 0; i < 4; i++) {
      const id = code()
      try {
        await ShortLink.create({ _id: id, target, kind: o.kind ?? 'OTHER', requestId: o.requestId, expiresAt })
        return `${base}/s/${id}`
      } catch (e: any) {
        if (e?.code !== 11000) throw e // duplicate code: try another
      }
    }
  } catch (e) {
    console.error('[links] short link failed', target, e)
  }
  return `${base}${target}`
}
