// Turn finished pages into one upload: a JPEG for a single page, one PDF for several.
import { canvas, ctx2d, toBlob } from './geometry'

/** Uploads are capped at 4 MB on the server (lib/storage.ts MAX_UPLOAD_BYTES); stay safely under it. */
const LIMIT = 3.8 * 1024 * 1024

/** Files produced by the scanner: compressImage() passes them through untouched (no re-encode, no time stamp). */
const scanned = new WeakSet<Blob>()
export const isScanned = (f: Blob) => scanned.has(f)

const stampName = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `scan-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function shrink(c: HTMLCanvasElement, max: number) {
  if (Math.max(c.width, c.height) <= max) return c
  const s = max / Math.max(c.width, c.height)
  const o = canvas(c.width * s, c.height * s)
  const g = ctx2d(o)
  g.imageSmoothingQuality = 'high'
  g.drawImage(c, 0, 0, o.width, o.height)
  return o
}

/** Encode pages, stepping quality/size down until the result fits the upload limit. */
const STEPS: [number, number][] = [
  [2000, 0.85],
  [2000, 0.72],
  [1700, 0.65],
  [1400, 0.6],
  [1200, 0.5],
]

export async function jpegFile(page: HTMLCanvasElement, name = stampName()): Promise<File> {
  let blob: Blob | null = null
  for (const [max, q] of STEPS) {
    blob = await toBlob(shrink(page, max), 'image/jpeg', q)
    if (blob.size <= LIMIT) break
  }
  const f = new File([blob!], `${name}.jpg`, { type: 'image/jpeg' })
  scanned.add(f)
  return f
}

export async function pdfFile(pages: HTMLCanvasElement[], name = stampName()): Promise<File> {
  const { PDFDocument } = await import('pdf-lib')
  let bytes: Uint8Array | null = null
  for (const [max, q] of STEPS) {
    const doc = await PDFDocument.create()
    doc.setTitle(name)
    doc.setCreator('Unico HomeCare scanner')
    for (const p of pages) {
      const c = shrink(p, max)
      const jpg = await doc.embedJpg(new Uint8Array(await (await toBlob(c, 'image/jpeg', q)).arrayBuffer()))
      // A4 in points, turned to landscape for wide pages; the image fills it edge to edge, aspect kept
      const land = c.width > c.height
      const [PW, PH] = land ? [841.89, 595.28] : [595.28, 841.89]
      const s = Math.min(PW / c.width, PH / c.height)
      const w = c.width * s
      const h = c.height * s
      const page = doc.addPage([PW, PH])
      page.drawImage(jpg, { x: (PW - w) / 2, y: (PH - h) / 2, width: w, height: h })
    }
    bytes = await doc.save()
    if (bytes.byteLength <= LIMIT) break
  }
  const f = new File([bytes! as BlobPart], `${name}.pdf`, { type: 'application/pdf' })
  scanned.add(f)
  return f
}
