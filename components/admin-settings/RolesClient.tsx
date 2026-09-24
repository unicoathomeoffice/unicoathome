'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { btnClass, Tag } from '@/components/ui'
import { Field, FormError, Tick, useFieldErrors } from '@/components/people/form'
import { ROLES, ROLE_LABEL, type Permission, type Role } from '@/lib/constants'
import { PERMISSION_LABEL, PERM_KEYS, permsOf } from './permissions'
import { cx } from '@/lib/format'

export type CustomRoleDoc = { _id: string; code: string; name: string; baseRole: Role; permissions: string[]; description?: string; createdAt?: string }

export function NewRoleButton({ kind = 'p', label = 'New custom role', fromRole }: { kind?: 'p' | 'o'; label?: string; fromRole?: Role }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={btnClass(kind)} onClick={() => setOpen(true)}>
        {kind === 'p' ? <Plus size={16} /> : <Copy size={16} />} {label}
      </button>
      {open && <RoleDrawer fromRole={fromRole} onClose={() => setOpen(false)} />}
    </>
  )
}

export function CustomRoleCard({ role }: { role: CustomRoleDoc }) {
  const router = useRouter()
  const toast = useToast()
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const base = permsOf(role.baseRole)
  const added = role.permissions.filter((p) => !base.includes(p as Permission))
  const removed = base.filter((p) => !role.permissions.includes(p))
  return (
    <div className="rounded-card border border-slate-200 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold">{role.name}</span>
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-slate-700">{role.code}</span>
            <Tag tone="violet">custom</Tag>
          </div>
          <div className="mt-0.5 text-[12.5px] text-slate-500">
            Copied from <b className="text-slate-700">{ROLE_LABEL[role.baseRole]}</b> · {role.permissions.length} permissions
            {added.length ? ` · +${added.length} added` : ''}
            {removed.length ? ` · −${removed.length} removed` : ''}
          </div>
          {role.description && <div className="mt-1.5 text-[13px] text-slate-700">{role.description}</div>}
          {(added.length > 0 || removed.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {added.map((p) => (
                <Tag key={p} tone="green">
                  + {PERMISSION_LABEL[p as Permission] ?? p}
                </Tag>
              ))}
              {removed.map((p) => (
                <Tag key={p} tone="red">
                  − {PERMISSION_LABEL[p] ?? p}
                </Tag>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => setEdit(true)} className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label={`Edit ${role.name}`}>
          <Pencil size={15} />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm(`Delete the custom role “${role.name}”?`)) return
            setBusy(true)
            try {
              await api(`/roles/${role._id}`, { method: 'DELETE' })
              toast('Custom role deleted')
              router.refresh()
            } catch (e: any) {
              toast(e?.message ?? 'Failed', 'err')
            } finally {
              setBusy(false)
            }
          }}
          className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-[#FEF2F2] hover:text-[#B91C1C]"
          aria-label={`Delete ${role.name}`}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
        </button>
      </div>
      {edit && <RoleDrawer role={role} onClose={() => setEdit(false)} />}
    </div>
  )
}

function RoleDrawer({ role, fromRole, onClose }: { role?: CustomRoleDoc; fromRole?: Role; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const fe = useFieldErrors()
  const [busy, setBusy] = useState(false)
  const [baseRole, setBaseRole] = useState<Role>(role?.baseRole ?? fromRole ?? 'NURSE')
  const [name, setName] = useState(role?.name ?? '')
  const [code, setCode] = useState(role?.code ?? '')
  const [codeTouched, setCodeTouched] = useState(!!role)
  const [description, setDescription] = useState(role?.description ?? '')
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? permsOf(role?.baseRole ?? fromRole ?? 'NURSE'))
  const base = permsOf(baseRole)

  async function save() {
    fe.clear()
    setBusy(true)
    try {
      if (role) await api(`/roles/${role._id}`, { method: 'PATCH', body: { name: name.trim(), description: description.trim(), permissions: perms } })
      else await api('/roles', { body: { code: code.trim(), name: name.trim(), baseRole, description: description.trim() || undefined, permissions: perms } })
      toast(role ? 'Custom role saved' : 'Custom role created')
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
      width={560}
      title={role ? `Edit ${role.name}` : 'New custom role'}
      sub="A copy of a fixed role with a different permission set"
      footer={
        <>
          <div className="flex-1" />
          <button className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button className={btnClass('p')} disabled={busy} onClick={save}>
            {busy && <Loader2 size={16} className="animate-spin" />} {role ? 'Save role' : 'Create role'}
          </button>
        </>
      }
    >
      <FormError message={fe.message} />
      <div className="mb-4 rounded-lg bg-[#EDE9FE] px-3.5 py-2.5 text-[12.5px] text-[#5B21B6]">
        A custom role is <b>enforced</b>: assign it to a user in <b>Staff → Edit user</b> and every permission check uses this list instead of the base role. The base role still decides web/app access and which home screen the user gets.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Copy from (base role)" className="col-span-2">
          <select
            className="hc-input"
            value={baseRole}
            disabled={!!role}
            onChange={(e) => {
              const r = e.target.value as Role
              setBaseRole(r)
              setPerms(permsOf(r))
            }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]} ({r})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name" error={fe.errors.name}>
          <input
            className="hc-input"
            value={name}
            placeholder="Senior nurse (supervisor)"
            onChange={(e) => {
              setName(e.target.value)
              if (!codeTouched)
                setCode(
                  e.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]+/g, '_')
                    .replace(/^_|_$/g, '')
                    .slice(0, 40),
                )
            }}
          />
        </Field>
        <Field label="Code" error={fe.errors.code}>
          <input
            className="hc-input font-mono text-[13px]"
            value={code}
            disabled={!!role}
            placeholder="SENIOR_NURSE"
            onChange={(e) => {
              setCodeTouched(true)
              setCode(e.target.value.toUpperCase().replace(/\s+/g, '_'))
            }}
          />
        </Field>
        <Field label="Description" error={fe.errors.description} className="col-span-2">
          <textarea className="hc-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who gets this and why" />
        </Field>
      </div>
      <div className="mb-2 mt-5 flex items-center gap-2">
        <div className="flex-1 text-[13px] font-bold">Permissions · {perms.length}</div>
        <button type="button" className="text-[12px] font-semibold text-primary-700" onClick={() => setPerms(base)}>
          Reset to {baseRole}
        </button>
      </div>
      <div className="overflow-hidden rounded-card border border-slate-200">
        {PERM_KEYS.map((p) => {
          const on = perms.includes(p)
          const inBase = base.includes(p)
          return (
            <label key={p} className="flex cursor-pointer items-center gap-3 border-t border-slate-100 px-3.5 py-2.5 text-[13px] first:border-t-0 hover:bg-slate-50">
              <Tick on={on} onChange={(x) => setPerms((s) => (x ? [...s, p] : s.filter((y) => y !== p)))} label={p} />
              <span className="min-w-0 flex-1">
                <span className="block">{PERMISSION_LABEL[p]}</span>
                <span className="font-mono text-[10.5px] text-slate-400">{p}</span>
              </span>
              {on !== inBase && <span className={cx('text-[11px] font-bold', on ? 'text-[#15803D]' : 'text-[#B91C1C]')}>{on ? 'added' : 'removed'}</span>}
            </label>
          )
        })}
      </div>
      {fe.errors.permissions && <span className="mt-1 block text-[12px] font-semibold text-[#B91C1C]">{fe.errors.permissions}</span>}
    </Drawer>
  )
}
