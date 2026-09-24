import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { sweep, reminders, dailyDigest } from '@/lib/services/jobs'

/**
 * Scheduled jobs. Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`.
 * /api/v1/jobs/sweep · /reminders · /digest · /all
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ job: string }> }) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Bad cron secret' } }, { status: 401 })
  await db()
  const { job } = await ctx.params
  const out: Record<string, unknown> = {}
  if (job === 'sweep' || job === 'all') out.sweep = await sweep(true)
  if (job === 'reminders' || job === 'all') out.reminders = await reminders()
  if (job === 'digest' || job === 'all') out.digest = await dailyDigest()
  if (!Object.keys(out).length) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Unknown job' } }, { status: 404 })
  return NextResponse.json({ ok: true, ...out })
}
