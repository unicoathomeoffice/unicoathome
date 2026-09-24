// W16 before / after viewer. Server-safe.
import { cx } from '@/lib/format'

type Row = { action: string; actorName?: string; actorRole?: string; client?: string; ip?: string; userAgent?: string; entity?: string; entityId?: string; entityLabel?: string; before?: unknown; after?: unknown }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function show(v: unknown): string {
  if (v === undefined) return '—'
  if (v === null) return 'null'
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : v
  if (typeof v === 'object') return JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ')
  return String(v)
}

function device(ua?: string) {
  if (!ua) return null
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS/.test(ua)) return 'Mac'
  return ua.slice(0, 30)
}

export function AuditDiff({ row, time, day }: { row: Row; time: string; day: string }) {
  const b = row.before
  const a = row.after
  const keyed = (isObj(b) || b == null) && (isObj(a) || a == null) && (isObj(b) || isObj(a))
  const keys = keyed ? [...new Set([...Object.keys((b as object) ?? {}), ...Object.keys((a as object) ?? {})])] : []
  const changed = (k: string) => JSON.stringify((b as any)?.[k]) !== JSON.stringify((a as any)?.[k])
  const meta = [row.actorName ? `${row.actorName} (${row.actorRole ?? 'SYSTEM'})` : 'System', row.client, device(row.userAgent) && `device ${device(row.userAgent)}`, row.ip && `ip ${row.ip.split('.').slice(0, 2).join('.')}.•••`].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="break-all font-mono text-[14px] font-bold">
          {row.action} · {time}
        </div>
        <div className="mt-1 text-[12px] leading-5 text-slate-500">
          {day} · {meta}
          <br />
          {row.entity ?? '—'}
          {row.entityId ? ` / ${row.entityId}` : ''}
          {row.entityLabel ? ` · ${row.entityLabel}` : ''}
        </div>
      </div>

      {keyed ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 text-[12px]">
          <div className="grid grid-cols-[minmax(80px,.8fr)_1fr_1fr] bg-slate-50 text-[11px] font-bold uppercase tracking-[.05em] text-slate-500">
            <div className="px-2.5 py-2">Field</div>
            <div className="px-2.5 py-2 text-[#B91C1C]">Before</div>
            <div className="px-2.5 py-2 text-[#15803D]">After</div>
          </div>
          {keys.map((k) => {
            const c = changed(k)
            return (
              <div key={k} className={cx('grid grid-cols-[minmax(80px,.8fr)_1fr_1fr] border-t border-slate-100', c && 'bg-[#FFFBEB]')}>
                <div className={cx('break-all px-2.5 py-1.5 font-mono', c ? 'font-bold text-slate-900' : 'text-slate-500')}>{k}</div>
                <div className={cx('break-all px-2.5 py-1.5 font-mono', c && (b as any)?.[k] !== undefined ? 'bg-[#FEF2F2] text-[#991B1B]' : 'text-slate-600')}>{show((b as any)?.[k])}</div>
                <div className={cx('break-all px-2.5 py-1.5 font-mono', c && (a as any)?.[k] !== undefined ? 'bg-[#F0FDF4] text-[#166534]' : 'text-slate-600')}>{show((a as any)?.[k])}</div>
              </div>
            )
          })}
          {!keys.length && <div className="px-2.5 py-3 text-slate-400">No field values recorded</div>}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.05em] text-[#B91C1C]">Before</div>
            <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#FEF2F2] p-2.5 font-mono text-[11.5px] text-[#991B1B]">{JSON.stringify(b ?? null, null, 2)}</pre>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[.05em] text-[#15803D]">After</div>
            <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#F0FDF4] p-2.5 font-mono text-[11.5px] text-[#166534]">{JSON.stringify(a ?? null, null, 2)}</pre>
          </div>
        </div>
      )}
      <div className="text-[12px] leading-5 text-slate-500">Changed fields are highlighted. Audit rows cannot be edited or deleted; report and message exports are logged too.</div>
    </div>
  )
}
