import 'server-only'
import { ServiceType } from '../models'
import { getSettings, HOD_CATEGORIES, type HodContact, type HodGroup } from '../settings'
import { waNumber } from '../messaging'

// Department-head alert groups (Settings → Notification rules). The four built-in groups follow a service category
// (Doctor / Nursing / Lab / Physio) so new services join automatically; custom groups list service codes or "ALL".
// A person can be narrowed to some of the group's services.

const CAT_TITLE: Record<string, string> = { Doctor: 'Doctor service', Nursing: 'Nursing service', Lab: 'Phlebotomy / Lab', Physio: 'Physiotherapy' }

/** Groups + contacts, upgrading the first version (contacts keyed by category, no groups) on the fly. */
export function hodConfig(cfg: { enabled: boolean; groups?: HodGroup[]; contacts: HodContact[] }) {
  const groups: HodGroup[] = cfg.groups?.length ? cfg.groups : HOD_CATEGORIES.map((c) => ({ id: `cat-${c}`, name: CAT_TITLE[c], category: c, services: [], message: '', active: true }))
  const contacts = (cfg.contacts ?? []).map((c) => ({ ...c, groupId: c.groupId || (c.category ? `cat-${c.category}` : groups[0]?.id) }))
  return { enabled: cfg.enabled, groups, contacts }
}

/** Who should hear about a request: one entry per phone number, with the group whose message to use. */
export async function hodRecipients(r: { services?: { serviceTypeId?: unknown; code?: string }[] }) {
  const s = await getSettings()
  const { enabled, groups, contacts } = hodConfig(s.hodAlerts as any)
  if (!enabled || !contacts.length) return []
  const codes = (r.services ?? []).map((x) => x.code).filter(Boolean) as string[]
  const types = await ServiceType.find({ _id: { $in: (r.services ?? []).map((x) => x.serviceTypeId).filter(Boolean) } }).select('code category').lean<any[]>()
  const cats = new Set(types.map((t) => String(t.category ?? '').toLowerCase()))
  const groupHits = (g: HodGroup) => {
    if (!g.active) return [] as string[]
    if (g.services === 'ALL') return codes
    if (g.category) return types.filter((t) => String(t.category ?? '').toLowerCase() === g.category!.toLowerCase()).map((t) => t.code)
    return codes.filter((c) => (g.services as string[]).includes(c))
  }
  const seen = new Set<string>()
  const out: { name: string; designation: string; phone: string; group: HodGroup }[] = []
  for (const g of groups) {
    const hits = groupHits(g)
    if (!hits.length && !(g.category && cats.has(g.category.toLowerCase()))) continue
    for (const c of contacts) {
      if (c.groupId !== g.id || !c.active) continue
      if (c.services?.length && !c.services.some((x) => hits.includes(x))) continue // person limited to some services
      const n = waNumber(c.phone)
      if (!n || seen.has(n)) continue
      seen.add(n)
      out.push({ name: c.name, designation: c.designation, phone: c.phone, group: g })
    }
  }
  return out
}
