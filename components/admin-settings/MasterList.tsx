'use client'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { api, Drawer, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { Field, FormError, useFieldErrors } from '@/components/people/form'
import { cx } from '@/lib/format'

export type MasterCol = {
  key: string
  label: string
  width: string
  type?: 'text' | 'number' | 'select'
  options?: { value: string; label: string }[]
  suffix?: string
  placeholder?: string
  bold?: boolean
  hint?: string
}
export type MasterItem = { _id: string; isActive?: boolean; sortOrder?: number; inUse?: number; [k: string]: unknown }

/**
 * Generic master list (W10 / A5): reorder with arrows (sortOrder), active toggle, add / edit drawer,
 * delete with in-use guard (API answers 400 → offer Deactivate).
 */
export function MasterList({
  kind,
  title,
  addLabel,
  nameKey,
  cols,
  items,
  usageLabel,
  usageNoun = 'user',
  canEdit = true,
  addKind = 'p',
  footer,
  extraAddFields,
}: {
  kind: string
  title: ReactNode
  addLabel: string
  nameKey: string
  cols: MasterCol[]
  items: MasterItem[]
  usageLabel?: string
  usageNoun?: string
  canEdit?: boolean
  addKind?: 'p' | 'o'
  footer?: ReactNode
  extraAddFields?: Record<string, unknown>
}) {
  const router = useRouter()
  const toast = useToast()
  const [rows, setRows] = useState(items)
  const [prevItems, setPrevItems] = useState(items)
  const [editing, setEditing] = useState<MasterItem | 'new' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [warning, setWarning] = useState<{ item: MasterItem; message: string } | null>(null)
  if (items !== prevItems) {
    setPrevItems(items)
    setRows(items)
  }

  const grid = `28px ${cols.map((c) => c.width).join(' ')} ${usageLabel ? '60px ' : ''}64px ${canEdit ? '72px' : ''}`
  const label = (it: MasterItem) => String(it[nameKey] ?? '')

  async function patch(it: MasterItem, body: Record<string, unknown>, ok?: string) {
    setBusyId(it._id)
    try {
      await api(`/master/${kind}/${it._id}`, { method: 'PATCH', body })
      if (ok) toast(ok)
      router.refresh()
      return true
    } catch (e: any) {
      toast(e?.message ?? 'Failed', 'err')
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    setRows(next)
    setBusyId(next[j]._id)
    try {
      // normalise sortOrder to the visible order; only PATCH rows that changed
      await Promise.all(next.map((r, k) => (r.sortOrder !== k ? api(`/master/${kind}/${r._id}`, { method: 'PATCH', body: { sortOrder: k } }) : null)))
      router.refresh()
    } catch (e: any) {
      toast(e?.message ?? 'Could not reorder', 'err')
      setRows(items)
    } finally {
      setBusyId(null)
    }
  }

  async function remove(it: MasterItem) {
    if (!window.confirm(`Delete “${label(it)}”? This cannot be undone.`)) return
    setBusyId(it._id)
    try {
      await api(`/master/${kind}/${it._id}`, { method: 'DELETE' })
      toast(`${label(it)} deleted`)
      setWarning(null)
      router.refresh()
    } catch (e: any) {
      if (e?.status === 400) setWarning({ item: it, message: `“${label(it)}” is used by ${it.inUse ?? 'some'} ${usageNoun}${it.inUse === 1 ? '' : 's'} — it can be deactivated but not deleted.` })
      else toast(e?.message ?? 'Failed', 'err')
    } finally {
      setBusyId(null)
    }
  }

  const display = (c: MasterCol, it: MasterItem) => {
    const v = it[c.key]
    if (v == null || v === '') return <span className="text-slate-400">—</span>
    if (c.type === 'select') return c.options?.find((o) => o.value === String(v))?.label ?? <span className="text-slate-400">—</span>
    return `${v}${c.suffix ?? ''}`
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1 text-[15px] font-bold">{title}</div>
        {canEdit && (
          <button type="button" className={btnClass(addKind)} onClick={() => setEditing('new')}>
            <Plus size={16} /> {addLabel}
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-card border border-slate-200">
        <div className="overflow-x-auto">
          <div className="min-w-fit">
            <div className="grid h-11 items-center border-b border-slate-200 bg-slate-50 px-3 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500" style={{ gridTemplateColumns: grid }}>
              <span />
              {cols.map((c) => (
                <span key={c.key} className="truncate pr-3">
                  {c.label}
                </span>
              ))}
              {usageLabel && <span className="pr-3">{usageLabel}</span>}
              <span>Active</span>
              {canEdit && <span />}
            </div>
            {rows.length === 0 && <div className="px-5 py-10 text-center text-sm text-slate-400">Nothing here yet — add the first one.</div>}
            {rows.map((it, i) => (
              <div key={it._id} className={cx('grid min-h-[50px] items-center border-t border-slate-100 px-3 py-1.5 text-sm first:border-t-0', it.isActive === false && 'bg-slate-50/70 text-slate-500')} style={{ gridTemplateColumns: grid }}>
                <span className="flex flex-col items-center">
                  {canEdit && (
                    <>
                      <button type="button" disabled={i === 0 || !!busyId} onClick={() => move(i, -1)} className="text-slate-400 hover:text-primary disabled:opacity-30" aria-label={`Move ${label(it)} up`}>
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" disabled={i === rows.length - 1 || !!busyId} onClick={() => move(i, 1)} className="text-slate-400 hover:text-primary disabled:opacity-30" aria-label={`Move ${label(it)} down`}>
                        <ArrowDown size={14} />
                      </button>
                    </>
                  )}
                </span>
                {cols.map((c) => (
                  <span key={c.key} className={cx('min-w-0 truncate pr-3', c.bold && 'font-semibold text-slate-900')}>
                    {display(c, it)}
                  </span>
                ))}
                {usageLabel && <span className={cx('pr-3', (it.inUse ?? 0) > 0 ? 'font-semibold text-slate-900' : 'text-slate-400')}>{it.inUse ?? 0}</span>}
                <span>
                  <Toggle on={it.isActive !== false} disabled={!canEdit || busyId === it._id} onChange={(on) => patch(it, { isActive: on }, `${label(it)} ${on ? 'activated' : 'deactivated'}`)} label={`${label(it)} active`} />
                </span>
                {canEdit && (
                  <span className="flex items-center justify-end gap-1">
                    {busyId === it._id ? (
                      <Loader2 size={15} className="animate-spin text-primary" />
                    ) : (
                      <>
                        <button type="button" onClick={() => setEditing(it)} className="inline-flex size-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" aria-label={`Edit ${label(it)}`}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" onClick={() => remove(it)} className="inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-[#FEF2F2] hover:text-[#B91C1C]" aria-label={`Delete ${label(it)}`}>
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {warning && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-[#FDE68A] bg-[#FEF3C7] px-3.5 py-2.5 text-[13px] text-[#92400E]">
          <TriangleAlert size={16} className="flex-none" />
          <span className="flex-1">{warning.message}</span>
          {warning.item.isActive !== false && (
            <button
              type="button"
              className={btnClass('o', 'sm')}
              onClick={async () => {
                if (await patch(warning.item, { isActive: false }, `${label(warning.item)} deactivated`)) setWarning(null)
              }}
            >
              Deactivate
            </button>
          )}
          <button type="button" className="text-[12px] font-semibold underline" onClick={() => setWarning(null)}>
            Dismiss
          </button>
        </div>
      )}
      {footer}
      {editing && <MasterDrawer kind={kind} cols={cols} item={editing === 'new' ? undefined : editing} nextOrder={rows.length} title={editing === 'new' ? addLabel : `Edit ${label(editing)}`} onClose={() => setEditing(null)} extra={extraAddFields} />}
    </div>
  )
}

function MasterDrawer({ kind, cols, item, nextOrder, title, onClose, extra }: { kind: string; cols: MasterCol[]; item?: MasterItem; nextOrder: number; title: string; onClose: () => void; extra?: Record<string, unknown> }) {
  const router = useRouter()
  const toast = useToast()
  const fe = useFieldErrors()
  const [busy, setBusy] = useState(false)
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(cols.map((c) => [c.key, item?.[c.key] != null ? String(item[c.key]) : ''])))
  const [active, setActive] = useState(item?.isActive !== false)

  async function save() {
    fe.clear()
    setBusy(true)
    const body: Record<string, unknown> = { isActive: active }
    for (const c of cols) {
      const raw = v[c.key]?.trim() ?? ''
      if (c.type === 'number') {
        if (raw !== '') body[c.key] = Number(raw)
      } else if (item) body[c.key] = raw // '' clears on PATCH
      else if (raw) body[c.key] = raw
    }
    try {
      if (item) await api(`/master/${kind}/${item._id}`, { method: 'PATCH', body })
      else await api(`/master/${kind}`, { body: { ...extra, ...body, sortOrder: nextOrder } })
      toast(item ? 'Saved' : 'Added')
      onClose()
      router.refresh()
    } catch (e) {
      fe.fromError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width={440}
      title={title}
      footer={
        <>
          <div className="flex-1" />
          <button className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button className={btnClass('p')} onClick={save} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />} Save
          </button>
        </>
      }
    >
      <FormError message={fe.message} />
      <div className="flex flex-col gap-3.5">
        {cols.map((c, i) => (
          <Field key={c.key} label={c.label} error={fe.errors[c.key]} hint={c.hint}>
            {c.type === 'select' ? (
              <select className="hc-input" value={v[c.key]} onChange={(e) => setV((s) => ({ ...s, [c.key]: e.target.value }))}>
                <option value="">—</option>
                {c.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input className="hc-input" autoFocus={i === 0} inputMode={c.type === 'number' ? 'numeric' : undefined} value={v[c.key]} placeholder={c.placeholder} onChange={(e) => setV((s) => ({ ...s, [c.key]: e.target.value }))} />
            )}
          </Field>
        ))}
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3.5 py-2.5 text-sm">
          <span className="font-semibold">Active</span>
          <Toggle on={active} onChange={setActive} label="Active" />
        </div>
      </div>
    </Drawer>
  )
}
