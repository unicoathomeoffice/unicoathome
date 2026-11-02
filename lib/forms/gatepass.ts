import 'server-only'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { ansi, drawInBox, embedImage, fitText, logoPng } from './pdf'

// Vehicle gate pass for a Unico @ Home car trip (A5 portrait), generated when the transport section allots a car.

export type GatePassData = {
  no: string
  date: string
  vehicle: string // plate · model
  driver: string
  staff: string[]
  outTime: string
  returnTime: string
  destination: string
  purpose: string
  issuedBy: string
  issuedSign?: { data: Buffer; mime: string } | null
  hospital: { name: string; address: string; phone: string }
  footer?: string
}

const NAVY = rgb(0.12, 0.22, 0.39)
const PRIMARY = rgb(0, 0.565, 0.792)
const GREY = rgb(0.4, 0.43, 0.48)
const LINE = rgb(0.8, 0.83, 0.87)

export async function makeGatePass(d: GatePassData) {
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
  if (logo) {
    const img = await doc.embedPng(logo)
    drawInBox(page, img, M, y - 34, 130, 34)
  } else page.drawText(ansi(d.hospital.name), { x: M, y: y - 22, size: 16, font: bold, color: NAVY })
  page.drawText('VEHICLE GATE PASS', { x: W - M - bold.widthOfTextAtSize('VEHICLE GATE PASS', 13), y: y - 14, size: 13, font: bold, color: NAVY })
  fitText(page, `No. ${d.no}`, { x: W - M - 150, y: y - 30, maxWidth: 150, font, size: 9.5, color: GREY })
  y -= 46
  fitText(page, `${d.hospital.name} · ${d.hospital.address} · ${d.hospital.phone}`, { x: M, y, maxWidth: W - 2 * M, font, size: 8, color: GREY })
  y -= 10
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: 2.5, color: PRIMARY })
  y -= 26

  const field = (label: string, value: string, h = 30) => {
    page.drawText(label.toUpperCase(), { x: M, y: y + 12, size: 7.5, font: bold, color: GREY })
    fitText(page, value || '-', { x: M, y: y - 2, maxWidth: W - 2 * M, font: bold, size: 12, color: NAVY })
    page.drawLine({ start: { x: M, y: y - 8 }, end: { x: W - M, y: y - 8 }, thickness: 0.6, color: LINE })
    y -= h
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

  pair('Date', d.date, 'Vehicle', d.vehicle)
  field('Driver', d.driver)
  field('Staff on board', d.staff.join(', '))
  pair('Out time', d.outTime, 'Expected return', d.returnTime)
  field('Destination', d.destination)
  field('Purpose', d.purpose)

  // issued by + signature
  y -= 8
  page.drawText('ISSUED BY', { x: M, y: y + 12, size: 7.5, font: bold, color: GREY })
  if (d.issuedSign) {
    const img = await embedImage(doc, d.issuedSign.data, d.issuedSign.mime)
    if (img) drawInBox(page, img, M, y - 26, 110, 34)
  }
  page.drawLine({ start: { x: M, y: y - 30 }, end: { x: M + 160, y: y - 30 }, thickness: 0.8, color: NAVY })
  fitText(page, d.issuedBy, { x: M, y: y - 42, maxWidth: 170, font, size: 9, color: NAVY })

  // security box
  const bx = W - M - 170
  page.drawRectangle({ x: bx, y: y - 48, width: 170, height: 62, borderColor: NAVY, borderWidth: 0.8 })
  page.drawText('SECURITY', { x: bx + 8, y: y + 2, size: 8, font: bold, color: NAVY })
  page.drawText('Out:  ____________________', { x: bx + 8, y: y - 16, size: 8.5, font, color: NAVY })
  page.drawText('In:    ____________________', { x: bx + 8, y: y - 36, size: 8.5, font, color: NAVY })

  if (d.footer) fitText(page, d.footer, { x: M, y: 22, maxWidth: W - 2 * M, font, size: 7, color: GREY })
  return Buffer.from(await doc.save())
}
