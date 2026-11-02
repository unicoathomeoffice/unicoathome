import 'server-only'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { ansi, drawInBox, embedImage, fitText, logoPng, savePdf, wrapText } from './pdf'

// Petty cash voucher (A5 portrait) for staff travelling by Uber / Pathao / CNG when no hospital car is free. Given and
// approved by a coordinator from the request page; the cash counter pays against it and the staff signs "received".

export type PettyCashVoucherData = {
  no: string
  date: string // "2 Nov 2026 · 2:54 PM"
  paidTo: string // name · ID
  designation: string
  amount: number
  purpose: string
  mode: string
  destination: string
  approvedBy: string
  approvedSign?: { data: Buffer; mime: string } | null
  hospital: { name: string; address: string; phone: string }
  footer?: string
}

const NAVY = rgb(0.12, 0.22, 0.39)
const PRIMARY = rgb(0, 0.565, 0.792)
const GREY = rgb(0.4, 0.43, 0.48)
const LINE = rgb(0.8, 0.83, 0.87)
const TINT = rgb(0.94, 0.97, 0.99)

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function below1000(n: number): string {
  const h = Math.floor(n / 100)
  const r = n % 100
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` ${ONES[r % 10]}` : ''}`
  return [h ? `${ONES[h]} Hundred` : '', rest].filter(Boolean).join(' ')
}
/** 1,25,600 → "One Lakh Twenty Five Thousand Six Hundred" (Bangladeshi grouping: crore / lakh / thousand). */
export function takaInWords(amount: number) {
  let n = Math.round(Math.abs(amount))
  if (!n) return 'Zero'
  const parts: string[] = []
  for (const [unit, name] of [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1000, 'Thousand']] as const) {
    if (n >= unit) {
      parts.push(`${below1000(Math.floor(n / unit))} ${name}`)
      n %= unit
    }
  }
  if (n) parts.push(below1000(n))
  return parts.join(' ')
}

export async function makePettyCashVoucher(d: PettyCashVoucherData) {
  const doc = await PDFDocument.create()
  const W = 420
  const H = 595 // A5
  const page = doc.addPage([W, H])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const M = 28

  // header
  const logo = await logoPng()
  let y = H - M
  if (logo) drawInBox(page, await doc.embedPng(logo), M, y - 34, 130, 34)
  else page.drawText(ansi(d.hospital.name), { x: M, y: y - 22, size: 16, font: bold, color: NAVY })
  page.drawText('PETTY CASH VOUCHER', { x: W - M - bold.widthOfTextAtSize('PETTY CASH VOUCHER', 13), y: y - 14, size: 13, font: bold, color: NAVY })
  fitText(page, `No. ${d.no}`, { x: W - M - 150, y: y - 30, maxWidth: 150, font, size: 9.5, color: GREY })
  y -= 46
  fitText(page, `${d.hospital.name} · ${d.hospital.address} · ${d.hospital.phone}`, { x: M, y, maxWidth: W - 2 * M, font, size: 8, color: GREY })
  y -= 10
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: 2.5, color: PRIMARY })
  y -= 26

  const field = (label: string, value: string) => {
    page.drawText(label.toUpperCase(), { x: M, y: y + 12, size: 7.5, font: bold, color: GREY })
    fitText(page, value || '-', { x: M, y: y - 2, maxWidth: W - 2 * M, font: bold, size: 12, color: NAVY })
    page.drawLine({ start: { x: M, y: y - 8 }, end: { x: W - M, y: y - 8 }, thickness: 0.6, color: LINE })
    y -= 30
  }
  const pair = (l1: string, v1: string, l2: string, v2: string) => {
    const half = (W - 2 * M) / 2
    for (const [i, [l, v]] of [[l1, v1], [l2, v2]].entries()) {
      page.drawText(l.toUpperCase(), { x: M + i * half, y: y + 12, size: 7.5, font: bold, color: GREY })
      fitText(page, v || '-', { x: M + i * half, y: y - 2, maxWidth: half - 10, font: bold, size: 12, color: NAVY })
    }
    page.drawLine({ start: { x: M, y: y - 8 }, end: { x: W - M, y: y - 8 }, thickness: 0.6, color: LINE })
    y -= 30
  }

  pair('Date', d.date, 'Transport', d.mode)
  field('Paid to', d.paidTo)
  field('Designation', d.designation)

  // amount box: figures + words
  y -= 4
  page.drawRectangle({ x: M, y: y - 34, width: W - 2 * M, height: 50, color: TINT, borderColor: PRIMARY, borderWidth: 0.8 })
  page.drawText('AMOUNT', { x: M + 10, y: y + 4, size: 7.5, font: bold, color: GREY })
  page.drawText(`Tk ${Math.round(d.amount).toLocaleString('en-IN')}`, { x: M + 10, y: y - 16, size: 20, font: bold, color: NAVY })
  wrapText(page, `Taka ${takaInWords(d.amount)} only`, { x: M + 150, y: y - 6, maxWidth: W - 2 * M - 160, font, size: 9.5, lines: 2, color: NAVY })
  y -= 62

  field('Destination', d.destination)
  page.drawText('PURPOSE', { x: M, y: y + 12, size: 7.5, font: bold, color: GREY })
  wrapText(page, d.purpose || '-', { x: M, y: y - 2, maxWidth: W - 2 * M, font: bold, size: 11, lines: 2, color: NAVY })
  y -= 44

  // approved by (signature) · received by · accounts
  const col = (W - 2 * M) / 3
  const sigY = y - 18
  for (const [i, label] of ['Approved by', 'Received by', 'Accounts / cash'].entries()) {
    const x = M + i * col
    page.drawText(label.toUpperCase(), { x, y: y + 4, size: 7.5, font: bold, color: GREY })
    page.drawLine({ start: { x, y: sigY - 14 }, end: { x: x + col - 14, y: sigY - 14 }, thickness: 0.8, color: NAVY })
  }
  if (d.approvedSign) {
    const img = await embedImage(doc, d.approvedSign.data, d.approvedSign.mime)
    if (img) drawInBox(page, img, M, sigY - 12, col - 18, 28)
  }
  fitText(page, d.approvedBy, { x: M, y: sigY - 26, maxWidth: col - 14, font, size: 8.5, color: NAVY })
  fitText(page, d.paidTo.split(' · ')[0], { x: M + col, y: sigY - 26, maxWidth: col - 14, font, size: 8.5, color: GREY })

  if (d.footer) fitText(page, d.footer, { x: M, y: 22, maxWidth: W - 2 * M, font, size: 7, color: GREY })
  return savePdf(doc)
}
