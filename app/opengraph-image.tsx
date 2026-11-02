import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import sharp from 'sharp'

// The link-preview card for the site and every short link (/s/…): hero photo, logo, what we do.
export const alt = 'Unico HomeCare — doctors, nurses and lab tests at home in Dhaka'
export const size = { width: 1200, height: 630 }
// JPEG, not PNG: WhatsApp drops preview images much over ~300 KB (the PNG of this photo is 1.4 MB)
export const contentType = 'image/jpeg'

export default async function Image() {
  const pub = join(process.cwd(), 'public')
  // satori draws PNG/JPEG only: convert the WebP hero and the SVG logo once at build time
  const hero = await sharp(await readFile(join(pub, 'home-care-desktop.webp'))).resize(1200, 630, { fit: 'cover', position: 'right' }).jpeg({ quality: 82 }).toBuffer()
  const logo = await sharp(await readFile(join(pub, 'logo.svg')), { density: 400 }).resize({ height: 120 }).png().toBuffer()
  const src = (b: Buffer, t: string) => `data:${t};base64,${b.toString('base64')}`

  const card = new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', fontFamily: 'sans-serif' }}>
        <img src={src(hero, 'image/jpeg')} width={1200} height={630} style={{ position: 'absolute', inset: 0, objectFit: 'cover' }} alt="" />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', background: 'linear-gradient(90deg, rgba(255,255,255,0.97) 0%, rgba(255,255,255,0.92) 45%, rgba(255,255,255,0) 72%)' }} />
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 64px', width: 700, height: '100%' }}>
          <div style={{ display: 'flex', background: '#fff', borderRadius: 18, padding: '14px 22px', alignSelf: 'flex-start', boxShadow: '0 6px 24px rgba(31,56,100,.12)' }}>
            <img src={src(logo, 'image/png')} height={88} style={{ height: 88 }} alt="" />
          </div>
          <div style={{ marginTop: 34, fontSize: 60, fontWeight: 800, color: '#1F3864', lineHeight: 1.08, display: 'flex', flexDirection: 'column' }}>
            <span>Care at home,</span>
            <span style={{ color: '#0090CA' }}>by Unico Hospitals</span>
          </div>
          <div style={{ marginTop: 22, fontSize: 28, color: '#334155', lineHeight: 1.35, display: 'flex' }}>Doctors, nurses, physiotherapy and lab tests at your home in Dhaka.</div>
          <div style={{ marginTop: 30, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', background: '#0090CA', color: '#fff', fontSize: 24, fontWeight: 700, borderRadius: 999, padding: '10px 24px' }}>Unico HomeCare</div>
            <div style={{ display: 'flex', fontSize: 22, color: '#64748B' }}>Family Medicine · Dhaka</div>
          </div>
        </div>
      </div>
    ),
    size,
  )
  const jpg = await sharp(Buffer.from(await card.arrayBuffer())).jpeg({ quality: 78, mozjpeg: true }).toBuffer()
  return new Response(new Uint8Array(jpg), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400, immutable' } })
}
