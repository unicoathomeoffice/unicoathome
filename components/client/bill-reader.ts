'use client'
// Reads the text of a bill in the browser, free and without sending it anywhere: a PDF's text layer (unpdf), or OCR of a
// photo / pasted screenshot (tesseract.js, English). Both libraries load only when a bill is actually read.
import { parseBill, type ParsedBill } from '@/lib/bill-parse'

type Progress = (pct: number, label: string) => void
let worker: Promise<any> | null = null
let report: Progress | undefined

async function ocrWorker() {
  worker ??= import('tesseract.js').then(({ createWorker }) =>
    createWorker('eng', 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') report?.(Math.round(30 + m.progress * 70), 'Reading the bill…')
        else if (/load|initializ/i.test(m.status)) report?.(Math.round(m.progress * 30), 'Getting the reader ready…')
      },
    }),
  )
  try {
    return await worker
  } catch (e) {
    worker = null
    throw e
  }
}

/** Grey, contrast-stretched and enlarged: OCR reads thin thermal-print digits much better this way. */
async function prepare(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(2400 / bmp.width, 3400 / bmp.height, 3)
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, 0, 0, w, h)
  const img = g.getImageData(0, 0, w, h)
  const d = img.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000
    d[i] = y
    hist[y | 0]++
  }
  // stretch between the 2nd and 98th percentile
  const n = w * h
  let lo = 0
  let hi = 255
  for (let a = 0, s = 0; a < 256; a++) if ((s += hist[a]) > n * 0.02) { lo = a; break }
  for (let a = 255, s = 0; a >= 0; a--) if ((s += hist[a]) > n * 0.02) { hi = a; break }
  const k = 255 / Math.max(1, hi - lo)
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, (d[i] - lo) * k))
    d[i] = d[i + 1] = d[i + 2] = v
  }
  g.putImageData(img, 0, 0)
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not prepare the image'))), 'image/png'))
}

export async function billText(file: File, onProgress?: Progress): Promise<string> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    onProgress?.(20, 'Reading the PDF…')
    const { extractText, getDocumentProxy } = await import('unpdf')
    const doc = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()))
    const { text } = await extractText(doc, { mergePages: true })
    onProgress?.(100, 'Read')
    if (text.replace(/\s/g, '').length > 40) return text
    // a scanned PDF has no text layer: nothing to read without rendering it — the person fills the fields
    return ''
  }
  if (!file.type.startsWith('image/')) return ''
  report = onProgress
  try {
    const w = await ocrWorker()
    const { data } = await w.recognize(await prepare(file))
    return data.text as string
  } finally {
    report = undefined
  }
}

/** Text → invoice fields, with cross-checked totals. */
export async function readBill(file: File, onProgress?: Progress): Promise<ParsedBill & { text: string }> {
  const text = await billText(file, onProgress)
  return { ...parseBill(text), text }
}
