import 'server-only'
import { parse } from 'node-html-parser'
import { H360Error } from './h360'
import { readOnlyPost } from './h360-items'
import { forget, memo } from './memo'
import { getSettings } from './settings'

// H360's "Sub Store Stock Ledger" (Inventory → Departmental Activities), read-only, for the Family Medicine store only:
// Nursing Services - Family Medicine (sub_store_id 38423). Search returns an HTML table; each row's Details link carries
// the numeric item id used by the per-item transaction report (/inventory/stock_details).

export const FAMILY_MEDICINE_STORE = { id: '38423', name: 'Nursing Services - Family Medicine' }

export type H360StockRow = { code: string; itemId: string; name: string; generic: string; packType: string; uom: string; stock: number; purchasePrice: number; salesPrice: number; status: string }
export type H360Stock = { storeId: string; storeName: string; totalQty: number; items: H360StockRow[]; at: string }

const num = (v: string) => {
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}
const txt = (s?: string | null) => (s ?? '').replace(/\s+/g, ' ').trim()

async function storeId() {
  const s = await getSettings()
  return String((s as any).store?.h360SubStoreId || FAMILY_MEDICINE_STORE.id)
}

/** Current stock of the Family Medicine sub-store in H360 (cached 60 s; `fresh` reads it again). */
export async function fetchSubStoreStock(opts: { fresh?: boolean } = {}): Promise<H360Stock> {
  const id = await storeId()
  if (opts.fresh) forget(`h360st:${id}`)
  return memo(`h360st:${id}`, 60_000, async () => {
    const res = await readOnlyPost('/inventory/search_stock_ledger_list_subStore', { module_code: 'INVENTORY', item_id: '', store_id: '', sub_store_id: id, supplier_id: '' }, true, 'store')
    if (!res.ok) throw new H360Error('DOWN', `H360 stock ledger answered ${res.status}`)
    const html = await res.text()
    const doc = parse(html)
    const head = txt(doc.querySelector('h3')?.text)
    const rows = doc.querySelectorAll('tbody tr')
    if (!head && !rows.length) throw new H360Error('PARSE', 'H360 stock ledger page changed (no table found)')
    const items: H360StockRow[] = []
    let storeName = FAMILY_MEDICINE_STORE.name
    for (const tr of rows) {
      const td = tr.querySelectorAll('td').map((c) => txt(c.text))
      if (td.length < 11) continue
      const link = tr.querySelector('a.stock_detail')
      // only this department's store (the report is filtered already; this guards against a changed filter)
      if (link?.getAttribute('data-store_id') && link.getAttribute('data-store_id') !== id) continue
      storeName = td[10] || storeName
      items.push({
        code: td[1],
        itemId: link?.getAttribute('data-item_id') ?? '',
        packType: td[2],
        name: td[3],
        generic: td[4],
        uom: td[5],
        stock: num(td[6]),
        purchasePrice: num(td[7]),
        salesPrice: num(td[8]),
        status: td[9],
      })
    }
    const totalQty = num(head.match(/Total Item Qty\s*=\s*([\d.,-]+)/i)?.[1] ?? '') || items.reduce((a, i) => a + Math.max(0, i.stock), 0)
    return { storeId: id, storeName, totalQty, items, at: new Date().toISOString() }
  })
}

export type H360Txn = { date: string; type: string; ref: string; inQty: number; outQty: number; balance: number | null; raw: string[] }

/** One item's transactions in the sub-store (receipts, consumption, transfers) — H360's Details pop-up, read-only. */
export async function fetchItemTransactions(row: Pick<H360StockRow, 'itemId' | 'name'>): Promise<{ headers: string[]; rows: string[][] }> {
  const id = await storeId()
  if (!row.itemId) return { headers: [], rows: [] }
  return memo(`h360tx:${id}:${row.itemId}`, 5 * 60_000, async () => {
    const res = await readOnlyPost('/inventory/stock_details', { store_id: id, item_id: row.itemId, item_name: row.name, store_name: FAMILY_MEDICINE_STORE.name, opening_qty: '0' }, true, 'store')
    if (!res.ok) throw new H360Error('DOWN', `H360 stock details answered ${res.status}`)
    const doc = parse(await res.text())
    const headers = doc.querySelectorAll('thead th').map((th) => txt(th.text))
    const rows = doc
      .querySelectorAll('tbody tr')
      .map((tr) => tr.querySelectorAll('td').map((c) => txt(c.text)))
      .filter((r) => r.length > 1)
    return { headers, rows }
  })
}
