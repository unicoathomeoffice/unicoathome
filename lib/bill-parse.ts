// Reads the text of an H360 "Invoice Cum Receipt" (from OCR of a photo, or a PDF's text layer) into invoice fields.
// Pure and shared: the Add-invoice drawer runs it in the browser. OCR text is noisy, so every number is cross-checked
// (items → subtotal → bill amount → due) and a field that doesn't add up is left for the person to type.

export type BillItem = { name: string; rate: number; qty: number; discount: number; amount: number }
export type ParsedBill = {
  invoiceNo?: string
  /** other plausible invoice numbers seen (OCR can split / mangle the main one) — checked against H360 */
  invoiceCandidates: string[]
  trxId?: string
  date?: string // YYYY-MM-DD
  uhid?: string
  patientName?: string
  phone?: string
  items: BillItem[]
  subtotal?: number
  discount?: number
  billAmount?: number
  paid?: number
  due?: number
  remarks?: string
  /** totals that agree with each other */
  checks: { itemsMatch: boolean; billMatch: boolean; dueMatch: boolean }
  /** how much of the bill was read: none → nothing usable, partial → some fields, full → amounts agree */
  quality: 'none' | 'partial' | 'full'
}

/** OCR look-alikes inside a number: O→0, l/I/|→1, S→5, B→8; thousands commas and stray spaces dropped. */
function digits(s: string) {
  return s.replace(/[Oo]/g, '0').replace(/[lI|!]/g, '1').replace(/[S$]/g, '5').replace(/B/g, '8').replace(/[,\s]/g, '')
}
function money(s?: string): number | undefined {
  if (!s) return undefined
  const m = digits(s).match(/-?\d+(?:\.\d{1,2})?/)
  if (!m) return undefined
  const n = Number(m[0])
  return Number.isFinite(n) ? n : undefined
}
const near = (a?: number, b?: number, tol = 1) => a != null && b != null && Math.abs(a - b) <= tol

/** "Label : value" anywhere in the text; label may be OCR-damaged a little (handled by the regex the caller gives). */
function field(text: string, label: RegExp, value = String.raw`([-\d.,OolIS ]{1,14}\d)`) {
  const m = text.match(new RegExp(`(?:${label.source})` + String.raw`\s*[:;.,]?\s*` + value, 'i'))
  return m?.[1]
}

function toIsoDate(d: string, m: string, y: string): string | undefined {
  const dd = Number(d)
  const mm = Number(m)
  let yy = Number(y)
  if (yy < 100) yy += 2000
  if (!(dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12)) return undefined
  // a year OCR can't have meant: keep it only within a year of today
  const now = new Date().getFullYear()
  if (Math.abs(yy - now) > 1) return undefined
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

export function parseBill(raw: string): ParsedBill {
  const text = raw.replace(/\r/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  const lines: string[] = []
  // a long item name wraps onto the next line ("01 Home Lab … Unico @ Home" / "(Selected Areas) 1000.00 1 0.00 1000.00"):
  // join a numbered line without amounts to the line after it
  for (const l of text.split('\n').map((x) => x.trim()).filter(Boolean)) {
    const prev = lines[lines.length - 1]
    if (prev && /^[0-9OolI]{1,2}\s+[A-Za-z(]/.test(prev) && !/\d+(?:\.\d+)?\s+\d{1,3}\b/.test(prev) && !/^[0-9OolI]{1,2}\s+[A-Za-z(]/.test(l)) lines[lines.length - 1] = `${prev} ${l}`
    else lines.push(l)
  }
  const out: ParsedBill = { items: [], invoiceCandidates: [], checks: { itemsMatch: false, billMatch: false, dueMatch: false }, quality: 'none' }

  // ids
  const uhid = field(text, /U\s*H\s*[I1l]\s*D/, String.raw`([0-9OolI]{6,12})`)
  if (uhid) out.uhid = digits(uhid)
  const trx = field(text, /TRX\s*[I1l]\s*D/, String.raw`([0-9OolI/]{4,10})`)
  if (trx) out.trxId = digits(trx).replace(/\//g, '')
  const inv = field(text, /[I1l]nvo[il1]ce\s*[I1l]\s*D|[I1l]nv\.?\s*No|[I1l]nvoice\s*No|vo[il1]cs?\s*[I1l]D/, String.raw`([0-9OolI]{4,9})`)
  if (inv) out.invoiceNo = digits(inv)
  // candidates: the printed invoice no also sits under the barcode (top right) — 5–7 digit numbers near the top that
  // are not the UHID / TRX / phone
  const top = lines.slice(0, Math.max(8, Math.ceil(lines.length * 0.25))).join(' ')
  for (const m of top.matchAll(/(?<![\d])(\d{5,7})(?![\d])/g)) {
    const n = m[1]
    if (n === out.uhid || n === out.trxId || out.uhid?.includes(n)) continue
    if (!out.invoiceCandidates.includes(n)) out.invoiceCandidates.push(n)
  }
  if (out.invoiceNo && !out.invoiceCandidates.includes(out.invoiceNo)) out.invoiceCandidates.unshift(out.invoiceNo)

  const name = text.match(/Patient\s*Name\s*[:;]?\s*([A-Za-z][A-Za-z .'-]{1,60}?)(?:\s{2,}|\s+Date|\s+[I1l]nvoice|\s+REE|\n|$)/i) ?? text.match(/\bName\s*[:;]\s*([A-Z][A-Z .'-]{1,60}?)(?:\s{2,}|\s+[a-z]|\n|$)/)
  if (name) out.patientName = name[1].trim().replace(/\s+/g, ' ')
  const phone = text.match(/Contact\s*[:;]?\s*(\+?[0-9OolI ]{10,16})/i)
  if (phone) out.phone = digits(phone[1])

  // date: "Date of Invoice : 02/11/2026 10:55 am", else the "Billed By: … (02/11/2026 10:55 am)" stamp
  // (OCR misreads a digit of the year now and then: when the two printed dates disagree, the one nearer today wins)
  const dates = [/Date\s*of\s*[I1l]nvo[il1]ce\s*[:;]?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i, /[B3]illed\s*By[^(\n]*\(\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i, /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/]
    .map((re) => {
      const m = text.match(re)
      return m ? toIsoDate(m[1], m[2], m[3]) : undefined
    })
    .filter((x): x is string => !!x)
  const nowMs = Date.now()
  out.date = dates.slice(0, 2).sort((a, b) => Math.abs(Date.parse(a) - nowMs) - Math.abs(Date.parse(b) - nowMs))[0] ?? dates[0]

  // totals line: "Subtotal : 11,730.00 , Discount : 0.00 , Bill Amount :11730.00 , Paid:0.00 , Due : 11730.00"
  out.subtotal = money(field(text, /Sub\s*-?\s*total/))
  out.discount = money(field(text, /D[il1]sc(?:ount)?(?!\s*policy)/))
  out.billAmount = money(field(text, /B[il1]ll\s*Amount|Net\s*Payable|Payable/))
  out.paid = money(field(text, /Pa[il1]d(?!\s*By)/))
  out.due = money(field(text, /\bDue(?!\s*date)/))

  // item rows: "01 Copper 24 Hours Urine 3500 1 0.00 3500.00" — serial, name, rate, qty, [discount], [amount]
  for (const l of lines) {
    const m = l.match(/^(?:[0-9OolIp]{1,2}\s*)([A-Za-z(][^]*?)\s+([0-9OolI,]+(?:\.\d+)?)\s+([0-9]{1,3})(?:\s+([0-9OolI.,]+))?(?:\s+([0-9OolI.,]+)\S*)?\s*[:;.]?$/)
    if (!m) continue
    const nm = m[1].replace(/^[\s.:-]+/, '').trim()
    if (nm.length < 2 || /subtotal|discount|bill amount|paid|due|total/i.test(nm)) continue
    const rate = money(m[2])
    const qty = Number(m[3])
    if (rate == null || !qty || qty > 100) continue
    const dis = money(m[4]) ?? 0
    const lineAmount = rate * qty - (dis > rate * qty ? 0 : dis)
    out.items.push({ name: nm, rate, qty, discount: dis > rate * qty ? 0 : dis, amount: lineAmount })
  }

  const remarks = text.match(/Remarks?\s*[:;]\s*([^\n]{2,200})/i)
  if (remarks) out.remarks = remarks[1].trim().replace(/[.\s]+$/, '.').replace(/^\.$/, '') || undefined

  // cross-checks; repair one missing / misread number from the others when the rest agree
  const itemsSum = out.items.reduce((a, i) => a + i.amount, 0)
  if (out.items.length && out.subtotal == null) out.subtotal = itemsSum
  out.checks.itemsMatch = !!out.items.length && near(itemsSum, out.subtotal)
  const disc = out.discount ?? 0
  if (out.billAmount == null && out.subtotal != null) out.billAmount = out.subtotal - disc
  out.checks.billMatch = near((out.subtotal ?? NaN) - disc, out.billAmount)
  if (!out.checks.billMatch && out.checks.itemsMatch && out.billAmount != null && near(itemsSum - disc, out.billAmount)) out.checks.billMatch = true
  if (out.due != null && out.paid != null) out.checks.dueMatch = near((out.billAmount ?? NaN) - out.paid, out.due)
  // OCR drops a leading digit now and then ("Due : 1730.00"): trust the sum when everything else agrees
  if (!out.checks.dueMatch && out.billAmount != null && out.paid != null && out.checks.billMatch) {
    out.due = Math.max(0, out.billAmount - out.paid)
    out.checks.dueMatch = true
  } else if (!out.checks.dueMatch && out.billAmount != null && out.due != null && out.paid == null && near(out.billAmount, out.due)) {
    out.paid = 0
    out.checks.dueMatch = true
  }

  const found = [out.invoiceNo, out.subtotal ?? out.billAmount, out.date].filter((x) => x != null).length
  out.quality = out.checks.billMatch && out.checks.dueMatch ? 'full' : found ? 'partial' : 'none'
  return out
}
