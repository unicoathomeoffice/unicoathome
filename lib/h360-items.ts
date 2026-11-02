import 'server-only'
import { getH360Config, h360, H360Error } from './h360'
import { forget, memo } from './memo'

// H360's service / test / procedure catalog with prices — the same search as typing in H360's billing "Service" box.
//
// H360 IS READ-ONLY FOR THIS APP. We only search and view (prices, procedure list, patient details); we never save,
// create, update or delete anything in H360 — billing there stays a person's action. readOnlyPost() refuses every
// path that isn't a known search endpoint, so a mistake can't turn into an H360 invoice.

const READ_ONLY_POSTS = new Set(['/get-item-name-v1', '/patient-info-autocomplete', '/hospital-patient-search'])

/** POST to an H360 *search* endpoint only (form-encoded, AJAX headers, CSRF). Anything else throws. */
export async function readOnlyPost(path: string, fields: Record<string, string>, retry = true): Promise<Response> {
  if (!READ_ONLY_POSTS.has(path)) throw new Error(`H360 is read-only for this app: ${path} is not an allowed search`)
  const res = await h360(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-csrf-token': await token(), 'x-requested-with': 'XMLHttpRequest', accept: 'application/json' },
    body: new URLSearchParams(fields).toString(),
  })
  if ((res.status === 419 || res.status === 401) && retry) {
    forget('h360i:csrf')
    return readOnlyPost(path, fields, false)
  }
  return res
}

function token() {
  return memo('h360i:csrf', 30 * 60_000, async () => {
    const html = await (await h360('/uhl/patient-list', { headers: { 'x-requested-with': 'XMLHttpRequest' } })).text()
    const t = html.match(/name="_token"\s+value="([^"]+)"/)?.[1] ?? html.match(/csrf-token"\s+content="([^"]+)"/)?.[1]
    if (!t) throw new H360Error('PARSE', 'H360 page has no CSRF token')
    return t
  })
}

export type H360Item = { code: string; name: string; price: number; dept?: string; type?: string }

// every billable kind except medicines — as H360's own billing screen searches
const ITEM_TYPES = 'GENERIC,SERVICE,LAB,RAD,IPD,BED,SUR,AMB,FOOD,PTET,PTTE,OPD,COMS,ADM'

/** Search H360's catalog by name or code (min 2 characters). Max 20, cached 10 min per term. */
export async function searchH360Items(q: string, o: { patientType?: string } = {}): Promise<H360Item[]> {
  const term = q.trim()
  if (term.length < 2) return []
  if (!(await getH360Config())) throw new H360Error('NOT_CONFIGURED', 'H360 is not connected')
  return memo(`h360i:${(o.patientType ?? '').toUpperCase()}:${term.toLowerCase()}`, 10 * 60_000, async () => {
    const res = await readOnlyPost('/get-item-name-v1', { query: term, item_type: ITEM_TYPES, item_type_void: 'MED', su_no_id: '', corporate_id: '', patient_type: o.patientType ?? '', admission_id: '', patient_id: '' })
    if (!res.ok) throw new H360Error('DOWN', `H360 service search answered ${res.status}`)
    let rows: any[]
    try {
      const j = JSON.parse(await res.text())
      rows = Array.isArray(j) ? j : j.data ?? []
    } catch {
      throw new H360Error('PARSE', 'H360 service search did not return a list')
    }
    return rows
      .map((r) => ({
        code: String(r.item_code ?? '').trim(),
        name: String(r.item_name ?? '').replace(/\s+/g, ' ').trim(),
        price: Number(r.item_rate) || 0,
        dept: String(r.item_dept ?? '').trim() || undefined,
        type: String(r.itemtype_code ?? r.item_type ?? '').trim() || undefined,
      }))
      .filter((x) => x.name)
      .slice(0, 20)
  })
}
