import 'server-only'
import { AuditLog } from './models'
import type { SessionUser } from './auth'

type Meta = { ip?: string; userAgent?: string; client?: string }

/** Append-only audit trail. Never update or delete audit rows. */
export async function audit(
  actor: Pick<SessionUser, 'id' | 'name' | 'role'> | null,
  action: string,
  entity: string,
  entityId: unknown,
  change: { before?: unknown; after?: unknown; label?: string } = {},
  meta: Meta = {},
) {
  try {
    await AuditLog.create({
      actorId: actor?.id,
      actorName: actor?.name ?? 'System',
      actorRole: actor?.role ?? 'SYSTEM',
      action,
      entity,
      entityId: entityId == null ? undefined : String(entityId),
      entityLabel: change.label,
      before: change.before,
      after: change.after,
      ...meta,
      serverAt: new Date(),
    })
  } catch (e) {
    console.error('[audit] failed', action, e)
  }
}

/** Shallow diff of two plain objects — only changed keys, for before/after rows. */
export function diff(before: Record<string, any>, after: Record<string, any>) {
  const b: Record<string, any> = {}
  const a: Record<string, any> = {}
  for (const k of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) {
      b[k] = before?.[k]
      a[k] = after?.[k]
    }
  }
  return { before: b, after: a }
}
