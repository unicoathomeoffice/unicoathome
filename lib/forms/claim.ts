import 'server-only'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { ansi, drawInBox, embedImage, fitText, photoBudget, readForm, savePdf } from './pdf'

// The hospital's "Bill Submission Form Unico @ Home.xlsx" (assets/forms/bill-submission.xlsx): three sheets —
// Top Sheet (Bill Submission Form), Conveyance Claim Form, Food Allowance Claim Form — each with Date, Name,
// Designation, Employee ID, Department, rows 18–35 and Prepared / Review / Approved By. Filled with exceljs (layout and
// =SUM formulas kept) and drawn again as a PDF with the receipts appended as voucher pages.

export type ClaimLine = { kind: 'CONVEYANCE' | 'FOOD' | 'OTHER'; at?: Date | string; uhid?: string; patientName?: string; invoiceNo?: string; from?: string; to?: string; mode?: string; amount: number }
export type ClaimForm = {
  claimNo: string
  date: string
  employee: { name: string; designation: string; employeeId: string; department: string }
  lines: ClaimLine[]
  preparedSign?: { data: Buffer; mime: string } | null
  reviewedBy?: string
  approvedBy?: string
  approvedSign?: { data: Buffer; mime: string } | null
  receipts?: { data: Buffer; mime: string; label: string }[]
}

const ROWS = 18 // template rows 18–35
const dt = (v?: Date | string) =>
  v ? new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).replace(',', '') : ''
const patient = (l: ClaimLine) => `UHID - ${l.uhid ?? ''}\nPatient Name - ${l.patientName ?? ''}\nInvoice No. - ${l.invoiceNo ?? ''}`
const HEADS: Record<ClaimLine['kind'], string> = { CONVEYANCE: 'Conveyance', FOOD: 'Food allowance', OTHER: 'Other expenses' }

/** Excel: the hospital workbook with the header and rows filled in. */
export async function claimXlsx(f: ClaimForm) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load((await readForm('bill-submission.xlsx')) as any)
  const head = (ws: any) => {
    ws.getCell('C7').value = f.date
    ws.getCell('C9').value = f.employee.name
    ws.getCell('C11').value = f.employee.designation
    ws.getCell('C13').value = f.employee.employeeId
    ws.getCell('F13').value = f.employee.department
    ws.getCell('A42').value = f.employee.name
    if (f.reviewedBy) ws.getCell('E42').value = f.reviewedBy
    if (f.approvedBy) ws.getCell('H42').value = f.approvedBy
  }
  const top = wb.getWorksheet('Top Sheet')!
  const conv = wb.getWorksheet('Conveyance')
  const food = wb.getWorksheet('Food')
  for (const ws of [top, conv, food]) if (ws) head(ws)

  // Top sheet: one row per expense head
  const heads = (['CONVEYANCE', 'FOOD', 'OTHER'] as const).map((k) => ({ k, sum: f.lines.filter((l) => l.kind === k).reduce((a, l) => a + l.amount, 0) })).filter((h) => h.sum > 0)
  const otherLines = f.lines.filter((l) => l.kind === 'OTHER')
  heads.forEach((h, i) => {
    const r = 18 + i
    top.getCell(`A${r}`).value = i + 1
    top.getCell(`B${r}`).value = h.k === 'OTHER' && otherLines.length ? `${HEADS.OTHER}: ${[...new Set(otherLines.map((l) => l.mode).filter(Boolean))].join(', ')}` : HEADS[h.k]
    top.getCell(`H${r}`).value = h.sum
  })

  const rows = (ws: any, list: ClaimLine[], kind: 'CONVEYANCE' | 'FOOD') => {
    list.slice(0, ROWS).forEach((l, i) => {
      const r = 18 + i
      ws.getCell(`A${r}`).value = dt(l.at)
      ws.getCell(`B${r}`).value = patient(l)
      ws.getCell(`B${r}`).alignment = { wrapText: true, vertical: 'middle' }
      ws.getCell(`C${r}`).value = l.from ?? ''
      ws.getCell(`E${r}`).value = l.to ?? ''
      ws.getCell(`G${r}`).value = l.mode ?? (kind === 'FOOD' ? 'Meal' : '')
      ws.getCell(`H${r}`).value = l.amount
      ws.getRow(r).height = Math.max(ws.getRow(r).height ?? 15, 45)
    })
  }
  if (conv) rows(conv, f.lines.filter((l) => l.kind === 'CONVEYANCE'), 'CONVEYANCE')
  if (food) rows(food, f.lines.filter((l) => l.kind === 'FOOD'), 'FOOD')
  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ---------------------------------------------------------------- PDF (same three sheets + receipts)
const NAVY = rgb(0.1, 0.12, 0.2)
const GREY = rgb(0.4, 0.43, 0.48)
const INK = rgb(0.05, 0.1, 0.35)

function sheet(page: PDFPage, font: PDFFont, bold: PDFFont, title: string, f: ClaimForm) {
  const W = page.getWidth()
  const c = (t: string, y: number, size: number, b = bold) => page.drawText(t, { x: (W - b.widthOfTextAtSize(t, size)) / 2, y, size, font: b, color: NAVY })
  c('Unico Hospitals PLC', 800, 15)
  c('23 Green Road, Dhaka-1205', 784, 10, font)
  c(title, 752, 13)
  const kv = (k: string, v: string, x: number, y: number, w: number) => {
    page.drawText(k, { x, y, size: 9.5, font: bold, color: NAVY })
    fitText(page, v, { x: x + 110, y, maxWidth: w - 110, font, size: 10, color: INK })
    page.drawLine({ start: { x: x + 108, y: y - 3 }, end: { x: x + w, y: y - 3 }, thickness: 0.4, color: GREY })
  }
  kv('Date', f.date, 40, 720, 250)
  kv('Name of the employee', f.employee.name, 40, 700, 515)
  kv('Designation', f.employee.designation, 40, 680, 515)
  kv('Employee ID no', f.employee.employeeId, 40, 660, 250)
  kv('Department', f.employee.department, 305, 660, 250)
}

function table(page: PDFPage, font: PDFFont, bold: PDFFont, cols: { label: string; w: number }[], rows: string[][], startY = 630) {
  const x0 = 40
  const rowH = 38
  let y = startY
  const line = (yy: number) => page.drawLine({ start: { x: x0, y: yy }, end: { x: x0 + cols.reduce((a, c) => a + c.w, 0), y: yy }, thickness: 0.6, color: NAVY })
  // header
  page.drawRectangle({ x: x0, y: y - 20, width: cols.reduce((a, c) => a + c.w, 0), height: 20, color: rgb(0.93, 0.95, 0.98) })
  let x = x0
  for (const c of cols) {
    fitText(page, c.label, { x: x + 4, y: y - 14, maxWidth: c.w - 8, font: bold, size: 8.5, color: NAVY })
    x += c.w
  }
  line(y)
  line(y - 20)
  y -= 20
  for (const r of rows) {
    x = x0
    r.forEach((cell, i) => {
      const parts = ansi(cell.replace(/\n/g, ' | ')).split(' | ')
      parts.slice(0, 3).forEach((p, j) => fitText(page, p, { x: x + 4, y: y - 11 - j * 10, maxWidth: cols[i].w - 8, font, size: 8, color: INK }))
      x += cols[i].w
    })
    y -= rowH
    line(y)
  }
  // verticals
  x = x0
  for (const c of [...cols, null]) {
    page.drawLine({ start: { x, y: startY }, end: { x, y }, thickness: 0.6, color: NAVY })
    if (c) x += c.w
  }
  return y
}

function footer(page: PDFPage, font: PDFFont, bold: PDFFont, total: number, y: number, f: ClaimForm, sign: any, approved: any) {
  page.drawText('Total Tk', { x: 360, y: y - 18, size: 10, font: bold, color: NAVY })
  page.drawText(total.toLocaleString('en-IN'), { x: 470, y: y - 18, size: 11, font: bold, color: INK })
  const sy = 95
  const col = (label: string, x: number, name?: string, img?: any) => {
    if (img) drawInBox(page, img, x, sy + 6, 110, 30)
    page.drawLine({ start: { x, y: sy }, end: { x: x + 140, y: sy }, thickness: 0.6, color: NAVY })
    page.drawText(label, { x, y: sy - 12, size: 9, font: bold, color: NAVY })
    if (name) fitText(page, name, { x, y: sy - 24, maxWidth: 140, font, size: 8.5, color: INK })
  }
  col('Prepared By', 40, f.employee.name, sign)
  col('Review By', 228, f.reviewedBy)
  col('Approved By', 415, f.approvedBy, approved)
  fitText(page, `Claim ${f.claimNo} · generated by Unico HomeCare`, { x: 40, y: 30, maxWidth: 515, font, size: 7, color: GREY })
}

export async function claimPdf(f: ClaimForm) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const sign = f.preparedSign ? await embedImage(doc, f.preparedSign.data, f.preparedSign.mime) : null
  const approved = f.approvedSign ? await embedImage(doc, f.approvedSign.data, f.approvedSign.mime) : null
  const A4: [number, number] = [595, 842]

  // Top sheet
  const heads = (['CONVEYANCE', 'FOOD', 'OTHER'] as const).map((k) => ({ k, sum: f.lines.filter((l) => l.kind === k).reduce((a, l) => a + l.amount, 0) })).filter((h) => h.sum > 0)
  const total = heads.reduce((a, h) => a + h.sum, 0)
  let p = doc.addPage(A4)
  sheet(p, font, bold, 'Bill Submission Form', f)
  let y = table(p, font, bold, [{ label: 'Serial No', w: 70 }, { label: 'Expenses Head', w: 330 }, { label: 'Total Amount', w: 115 }], heads.map((h, i) => [String(i + 1), HEADS[h.k], h.sum.toLocaleString('en-IN')]))
  footer(p, font, bold, total, y, f, sign, approved)

  const detail = (kind: 'CONVEYANCE' | 'FOOD', title: string, modeLabel: string) => {
    const list = f.lines.filter((l) => l.kind === kind)
    if (!list.length) return
    for (let i = 0; i < list.length; i += 13) {
      const chunk = list.slice(i, i + 13)
      p = doc.addPage(A4)
      sheet(p, font, bold, title, f)
      y = table(
        p,
        font,
        bold,
        [{ label: 'Date & Time', w: 75 }, { label: 'Patient Details', w: 135 }, { label: 'From', w: 80 }, { label: 'To', w: 80 }, { label: modeLabel, w: 80 }, { label: 'Total Amount', w: 65 }],
        chunk.map((l) => [dt(l.at), patient(l), l.from ?? '', l.to ?? '', l.mode ?? '', l.amount.toLocaleString('en-IN')]),
      )
      if (kind === 'FOOD') p.drawText('Original Vouchers Attached', { x: 40, y: y - 18, size: 9, font: bold, color: NAVY })
      footer(p, font, bold, list.reduce((a, l) => a + l.amount, 0), y, f, sign, approved)
    }
  }
  detail('CONVEYANCE', 'Conveyance Claim Form', 'Mode of Transport')
  detail('FOOD', 'Food Allowance Claim Form', 'Food Type')

  // receipts / vouchers
  for (const r of f.receipts ?? []) {
    if (/pdf/i.test(r.mime)) {
      try {
        const src = await PDFDocument.load(r.data)
        for (const pg of await doc.copyPages(src, src.getPageIndices())) doc.addPage(pg)
      } catch {}
      continue
    }
    const img = await embedImage(doc, r.data, r.mime, 'photo', photoBudget((f.receipts ?? []).length, 20 * 1024))
    if (!img) continue
    p = doc.addPage(A4)
    p.drawText(ansi(`Voucher · ${r.label}`), { x: 40, y: 805, size: 11, font: bold, color: NAVY })
    drawInBox(p, img, 40, 60, 515, 730)
  }
  return savePdf(doc)
}
