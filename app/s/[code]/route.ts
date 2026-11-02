import { after, NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ShortLink } from '@/lib/models'
import { baseUrl, LINK_PREVIEW, type LinkKind } from '@/lib/links'

// Link-preview crawlers read Open Graph tags instead of following us into a login page.
const BOT = /whatsapp|facebookexternalhit|facebot|meta-externalagent|twitterbot|telegrambot|slackbot|linkedinbot|discordbot|skypeuripreview|viber|pinterest|redditbot|googlebot|bingbot|applebot|embedly|bot\b|crawler|spider|preview/i

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const origin = baseUrl() || req.nextUrl.origin
  if (!/^[\w-]{3,32}$/.test(code)) return NextResponse.redirect(new URL('/', origin), 307)
  await db()
  const link = await ShortLink.findById(code).lean<{ _id: string; target: string; kind?: LinkKind; expiresAt?: Date }>()
  if (!link || (link.expiresAt && link.expiresAt < new Date())) return NextResponse.redirect(new URL('/', origin), 307)
  const to = new URL(link.target, origin)

  if (BOT.test(req.headers.get('user-agent') ?? '')) {
    const p = LINK_PREVIEW[link.kind ?? 'OTHER'] ?? LINK_PREVIEW.OTHER
    const self = `${origin}/s/${code}`
    const img = `${origin}/opengraph-image`
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(self)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Unico HomeCare">
<meta property="og:locale" content="en_BD">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${esc(self)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Unico HomeCare — care at home by Unico Hospitals">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0;url=${esc(to.toString())}">
</head><body><a href="${esc(to.toString())}">${esc(p.title)}</a></body></html>`
    return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', vary: 'user-agent' } })
  }

  // count the click after responding (serverless: after() keeps the function alive for it)
  after(() => ShortLink.updateOne({ _id: code }, { $inc: { clicks: 1 }, $set: { lastAt: new Date() } }).catch(() => {}))
  return NextResponse.redirect(to, { status: 307, headers: { 'cache-control': 'no-store' } })
}
