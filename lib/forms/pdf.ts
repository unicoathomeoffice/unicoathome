import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PDFFont, PDFPage, PDFImage, PDFDocument } from 'pdf-lib'

// Small helpers for filling / drawing hospital forms with pdf-lib (standard Helvetica, WinAnsi only).

export const formPath = (name: string) => path.join(process.cwd(), 'assets', 'forms', name)
export const readForm = (name: string) => fs.readFile(formPath(name))

/** Helvetica can only draw WinAnsi: drop what it can't (e.g. Bangla), keep common punctuation readable. */
export function ansi(s: unknown) {
  return String(s ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/৳/g, 'Tk ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Draw text on one line, shrinking the font down to `min` and then cutting with "…" so it fits `maxWidth`. */
export function fitText(page: PDFPage, text: unknown, o: { x: number; y: number; maxWidth: number; font: PDFFont; size?: number; min?: number; color?: any }) {
  let t = ansi(text)
  let size = o.size ?? 10
  const min = o.min ?? 7
  while (size > min && o.font.widthOfTextAtSize(t, size) > o.maxWidth) size -= 0.5
  if (o.font.widthOfTextAtSize(t, size) > o.maxWidth) {
    while (t.length > 1 && o.font.widthOfTextAtSize(`${t}...`, size) > o.maxWidth) t = t.slice(0, -1)
    t = `${t}...`
  }
  page.drawText(t, { x: o.x, y: o.y, size, font: o.font, color: o.color })
}

/** Wrap text into at most `lines` lines inside maxWidth (last line cut with "…"). */
export function wrapText(page: PDFPage, text: unknown, o: { x: number; y: number; maxWidth: number; font: PDFFont; size?: number; lineGap?: number; lines?: number; color?: any }) {
  const size = o.size ?? 9.5
  const words = ansi(text).split(' ')
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (o.font.widthOfTextAtSize(next, size) <= o.maxWidth) cur = next
    else {
      if (cur) out.push(cur)
      cur = w
    }
  }
  if (cur) out.push(cur)
  const max = o.lines ?? 2
  const shown = out.slice(0, max)
  if (out.length > max) {
    let last = shown[max - 1]
    while (last.length > 1 && o.font.widthOfTextAtSize(`${last}...`, size) > o.maxWidth) last = last.slice(0, -1)
    shown[max - 1] = `${last}...`
  }
  shown.forEach((l, i) => page.drawText(l, { x: o.x, y: o.y - i * (size + (o.lineGap ?? 3)), size, font: o.font, color: o.color }))
}

/** A tick inside a printed check box whose bottom-left corner is (x, y) and side `s`. */
export function tick(page: PDFPage, x: number, y: number, s = 11) {
  page.drawLine({ start: { x: x + 2, y: y + s * 0.5 }, end: { x: x + s * 0.42, y: y + 2 }, thickness: 1.6 })
  page.drawLine({ start: { x: x + s * 0.42, y: y + 2 }, end: { x: x + s + 1, y: y + s + 1 }, thickness: 1.6 })
}

/** Embed a stored signature / photo (PNG or JPG bytes). */
export async function embedImage(doc: PDFDocument, data: Buffer, mime: string): Promise<PDFImage | null> {
  try {
    return /png/i.test(mime) ? await doc.embedPng(data) : /jpe?g/i.test(mime) ? await doc.embedJpg(data) : null
  } catch {
    return null
  }
}

/** Draw an image inside a box (keeps aspect ratio, bottom-left anchored). */
export function drawInBox(page: PDFPage, img: PDFImage, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height)
  page.drawImage(img, { x, y, width: img.width * s, height: img.height * s })
}

/** Hospital logo as PNG (rasterised from public/logo.svg once per instance). */
let logo: Promise<Buffer | null> | null = null
export function logoPng() {
  logo ??= (async () => {
    try {
      const sharp = (await import('sharp')).default
      const svg = await fs.readFile(path.join(process.cwd(), 'public', 'logo.svg'))
      return await sharp(svg, { density: 300 }).resize({ height: 160 }).png().toBuffer()
    } catch {
      return null
    }
  })()
  return logo
}
