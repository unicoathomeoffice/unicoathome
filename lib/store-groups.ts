// Store items grouped the way staff think about them: a family ("IV cannula") with its sizes ("22G") and makers
// ("B Braun"). parseItemName() suggests the three parts from an item name; admins can change them per item.
// Pure (no server code) — used by the store page, the item drawer and the visit's consumables picker.

export type ItemParts = { family: string; variant: string; brand: string }

/** Families that come in several sizes / kinds — siblings must land on exactly the same family name. */
const FAMILIES: [RegExp, string][] = [
  [/\biv cannula\b/i, 'IV cannula'],
  [/\bdisposable syringe\b/i, 'Disposable syringe'],
  [/\binsulin syringe\b/i, 'Insulin syringe'],
  [/\bsurgical gloves\b/i, 'Surgical gloves (sterile)'],
  [/\bexamination gloves\b/i, 'Examination gloves'],
  [/\bball pen\b/i, 'Ball pen'],
  [/\broller bandage\b/i, 'Roller bandage'],
  [/\bzipper lock\b/i, 'Zipper lock poly bag'],
  [/\bpharmacy paper bag\b/i, 'Pharmacy paper bag'],
  [/\bsurgical tape\b/i, 'Surgical tape'],
  [/\b(cargo box|storage box)\b/i, 'Storage box'],
  [/\bface mask\b/i, 'Face mask'],
  [/\bmarker\b/i, 'Marker'],
  [/\bjasocaine\b/i, 'Jasocaine 2%'],
  [/\bfoleys? catheter\b/i, 'Foley catheter'],
  [/\bhypodermic needle\b/i, 'Hypodermic needle'],
]

/** Makers / origins as they appear in item names (brackets or words) → how we show them. */
const BRANDS: [RegExp, string][] = [
  [/\bb\.?\s?braun\b/i, 'B Braun'],
  [/\bbd\b/i, 'BD'],
  [/\bjmi\b/i, 'JMI'],
  [/\bcomfit\b/i, 'Comfit'],
  [/\bromsons\b/i, 'Romsons'],
  [/\b3m\b/i, '3M'],
  [/\bnipro\b/i, 'Nipro'],
  [/\bglucoleader\b/i, 'Glucoleader'],
  [/\bnichipore\b/i, 'Nichipore'],
  [/\bbashundhara\b/i, 'Bashundhara'],
  [/\bsepnil\b/i, 'Sepnil'],
  [/\bneoflon\b/i, 'BD'], // BD Neoflon
  [/\bindia\b/i, 'India'],
]

/** Size / kind tokens, most specific first. */
const SIZES: RegExp[] = [
  /\b\d+(?:\.\d+)?\s*cm\s*[x×*]\s*\d+(?:\.\d+)?\s*cm\b/i, // 6cm X 7cm, 10cm*10cm
  /\b\d+(?:\.\d+)?cm\s*x\s*\d+(?:\.\d+)?cm\b/i,
  /\((?:medium|small|large)\)/i,
  /\b\d+\s*x\s*\d+\b(?!\s*ply)/i, // 2x3 (poly bag)
  /\b\d+(?:\.\d+)?\s?(?:cc|ml|mg|gm|g|kg|l|fr)\b/i, // 10cc, 30g, 14 Fr, 30L
  /\b\d+\s?g\b/i, // 22G
  /\b\d+(?:\.\d+)?\s?(?:"|”|inch)/i, // 4", 6 inch, 6.5"
  /\bsize[-:\s]*\d+\b/i, // Size-07
  /\bsterile\s+\d+(?:\.\d+)?\b/i, // gloves 7.0
  /\b(?:black|blue|red|green)\s+ink\b/i,
  /\b(?:medium|small|large)\b/i,
]

const tidy = (s: string) =>
  s
    .replace(/\(\s*\)/g, '')
    .replace(/\s*[,/-]\s*$/g, '')
    .replace(/^[\s,/-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()

export function parseItemName(name: string): ItemParts {
  const full = name.replace(/\s+/g, ' ').trim()
  const brand = BRANDS.find(([rx]) => rx.test(full))?.[1] ?? ''
  let size = ''
  for (const rx of SIZES) {
    const m = full.match(rx)
    if (m) {
      size = m[0]
      break
    }
  }
  // clean the size label: "sterile 7.0" → "7.0", "(Medium)" → "Medium", "Black Ink" → "Black", "Size-07" → "Size 07"
  let variant = tidy(size.replace(/^sterile\s+/i, '').replace(/[()]/g, '').replace(/\s+ink$/i, '').replace(/^size[-:\s]*/i, 'Size '))
  const known = FAMILIES.find(([rx]) => rx.test(full))
  let family = ''
  if (known) {
    family = known[1]
    if (!variant) {
      // the words left after the family, e.g. "Board Marker" → "Board", "Jasocaine Inj 2% (local)" → "Inj"
      const rest = tidy(full.replace(known[0], ' ').replace(/\([^)]*\)/g, ' ').replace(/\b2%/g, ' '))
      variant = rest.split(' ').slice(0, 3).join(' ')
    }
  } else {
    // a one-off item: no family (it shows under its own name) and no size label
    family = ''
    variant = ''
  }
  if (variant && brand && variant.toLowerCase() === brand.toLowerCase()) variant = '' // "Sepnil Face Mask": the maker, not a size
  return { family, variant, brand }
}

/** A family's members, sorted by size (numbers first, small → large). */
export function sortVariants<T extends { variant?: string; name: string }>(list: T[]): T[] {
  const num = (v?: string) => {
    const m = (v ?? '').match(/\d+(?:\.\d+)?/)
    return m ? Number(m[0]) : Number.POSITIVE_INFINITY
  }
  return [...list].sort((a, b) => num(a.variant) - num(b.variant) || (a.variant ?? a.name).localeCompare(b.variant ?? b.name))
}

/** Group items into families (an item with no family is its own group, keyed by its name). */
export function groupItems<T extends { _id: string; name: string; family?: string; variant?: string; brand?: string }>(items: T[]) {
  const map = new Map<string, T[]>()
  for (const i of items) {
    const key = (i.family || i.name).trim().toLowerCase()
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(i)
  }
  return [...map.values()].map((members) => ({ family: members[0].family || members[0].name, members: sortVariants(members) }))
}

/** Stock state of an item: out ≤ 0 · low ≤ its alert level · ok */
export const stockState = (i: { stock?: number; alertBelow?: number }): 'out' | 'low' | 'ok' => ((i.stock ?? 0) <= 0 ? 'out' : (i.alertBelow ?? 0) > 0 && (i.stock ?? 0) <= (i.alertBelow ?? 0) ? 'low' : 'ok')
