import 'server-only'
import { z } from 'zod'
import { Equipment } from '../models'
import { audit, type Meta } from '../audit'
import { forgetMaster } from '../cached'
import { parseItemName } from '../store-groups'
import { moveStock } from './stock'
import type { SessionUser } from '../auth'

// Adding items to the Family Medicine store from any source — H360's item list, copy of an existing item, bulk paste /
// CSV, or by hand. One path: duplicates are skipped (same H360 code or same name), family / size / company are
// suggested from the name when not given, and the opening stock is logged as an OPENING move.

export const NewItem = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  unit: z.string().trim().min(1).max(20).default('pcs'),
  type: z.enum(['EQUIPMENT', 'CONSUMABLE']).default('CONSUMABLE'),
  h360Code: z.string().trim().max(30).optional(),
  family: z.string().trim().max(60).optional(),
  variant: z.string().trim().max(40).optional(),
  brand: z.string().trim().max(40).optional(),
  stock: z.coerce.number().int().min(-100000).max(1000000).default(0), // opening stock
  alertBelow: z.coerce.number().int().min(0).max(100000).optional(),
  tolerance: z.coerce.number().int().min(0).max(1000).optional(),
  notes: z.string().trim().max(300).optional(),
  copyFrom: z.string().regex(/^[a-f0-9]{24}$/i).optional(), // share this item's picture (copy of an existing item)
  source: z.enum(['H360', 'COPY', 'BULK', 'MANUAL']).default('MANUAL'),
})
export const NewItemsInput = z.object({ items: z.array(NewItem).min(1).max(500) })

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

export async function createStoreItems(input: z.infer<typeof NewItemsInput>, user: SessionUser, meta: Meta = {}) {
  const existing = await Equipment.find({}).select('name h360Code').lean<any[]>()
  const names = new Set(existing.map((e) => key(e.name)))
  const codes = new Set(existing.map((e) => e.h360Code).filter(Boolean))
  const added: { id: string; name: string }[] = []
  const skipped: { name: string; why: string }[] = []
  for (const it of input.items) {
    if (it.h360Code && codes.has(it.h360Code)) {
      skipped.push({ name: it.name, why: `H360 code ${it.h360Code} is already in the store` })
      continue
    }
    if (names.has(key(it.name))) {
      skipped.push({ name: it.name, why: 'An item with this name is already in the store' })
      continue
    }
    const p = parseItemName(it.name)
    const src = it.copyFrom ? await Equipment.findById(it.copyFrom).select('imageId').lean<any>() : null
    const e = await Equipment.create({
      name: it.name,
      unit: it.unit,
      type: it.type,
      h360Code: it.h360Code || undefined,
      family: it.family || p.family || undefined,
      variant: it.variant || p.variant || undefined,
      brand: it.brand || p.brand || undefined,
      alertBelow: it.alertBelow ?? 0,
      tolerance: it.tolerance ?? 0,
      notes: it.notes || (it.h360Code ? `H360 ${it.h360Code} · added ${it.source === 'H360' ? 'from the H360 item list' : 'by hand'}` : undefined),
      imageId: src?.imageId ?? undefined, // a copy shares the picture
      isActive: true,
      sortOrder: 900,
      createdBy: user.id,
    })
    if (it.stock) await moveStock(e._id, it.stock, 'OPENING', { note: `Opening stock · ${{ H360: 'from H360 item list', COPY: 'copy of an item', BULK: 'bulk add', MANUAL: 'added by hand' }[it.source]}`, by: user.id })
    await audit(user, 'equipment.create', 'equipment', e._id, { after: { name: it.name, unit: it.unit, type: it.type, h360Code: it.h360Code, stock: it.stock, source: it.source }, label: it.name }, meta)
    names.add(key(it.name))
    if (it.h360Code) codes.add(it.h360Code)
    added.push({ id: String(e._id), name: it.name })
  }
  if (added.length) forgetMaster()
  return { added, skipped }
}
