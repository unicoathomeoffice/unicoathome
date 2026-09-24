'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { EllipsisVertical, FileUp, KeyRound, Loader2, LogOut, Pencil, Ban, UserCheck, UserPlus, Download, CircleCheck, TriangleAlert, Clock } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { ROLES, SHIFTS, type Role } from '@/lib/constants'
import { TempPassword, UserDrawer, type StaffOptions, type StaffUser } from './UserDrawer'
import { downloadText, parseCsv, toCsv } from './form'
import { cx } from '@/lib/format'

export function AddUserButton({ options, canManage, label = 'Add user', presetRole, kind = 'p' }: { options: StaffOptions; canManage: boolean; label?: string; presetRole?: Role; kind?: 'p' | 'o' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={btnClass(kind)} onClick={() => setOpen(true)}>
        <UserPlus size={16} /> {label}
      </button>
      {open && <UserDrawer options={options} canManage={canManage} presetRole={presetRole} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Name cell: opens the edit (or read-only) drawer. `autoOpen` when arriving from ?edit=<id>. */
export function UserOpenButton({ user, options, canManage, autoOpen, children }: { user: StaffUser; options: StaffOptions; canManage: boolean; autoOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!autoOpen)
  return (
    <>
      <button type="button" className="flex w-full min-w-0 items-center gap-2.5 text-left" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <UserDrawer user={user} options={options} canManage={canManage} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Row menu: Edit · Suspend / Activate · Reset password · Force sign-out (SUPER_ADMIN) */
export function UserRowMenu({ user, options }: { user: StaffUser & { sessions?: number }; options: StaffOptions }) {
  const router = useRouter()
  const toast = useToast()
  const [menu, setMenu] = useState<null | { top: number; left: number }>(null)
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [temp, setTemp] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(null)
    const close = () => setMenu(null)
    document.addEventListener('mousedown', h)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', h)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  async function patch(body: Record<string, unknown>, ok: string, confirmText?: string) {
    setMenu(null)
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    try {
      const r = await api<{ temporaryPassword?: string }>(`/users/${user._id}`, { method: 'PATCH', body })
      toast(ok)
      if (r.temporaryPassword) setTemp(r.temporaryPassword)
      router.refresh()
    } catch (e: any) {
      toast(e?.message ?? 'Failed', 'err')
    } finally {
      setBusy(false)
    }
  }

  const item = 'flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13.5px] hover:bg-slate-50'
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          if (menu) return setMenu(null)
          const r = e.currentTarget.getBoundingClientRect()
          const h = 200
          setMenu({ top: r.bottom + h + 8 > window.innerHeight ? r.top - h - 4 : r.bottom + 4, left: Math.max(8, r.right - 224) })
        }}
        className="inline-flex size-8 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50" aria-label={`Actions for ${user.name}`}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <EllipsisVertical size={16} />}
      </button>
      {menu && (
        <div className="fixed z-40 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl" style={{ top: menu.top, left: menu.left }}>
          <button className={item} onClick={() => (setMenu(null), setEdit(true))}>
            <Pencil size={15} /> Edit
          </button>
          {user.status === 'PENDING' ? (
            <Link className={item} href="/settings/approvals?type=NEW_USER">
              <Clock size={15} /> Review in Approvals
            </Link>
          ) : user.status === 'SUSPENDED' ? (
            <button className={item} onClick={() => patch({ status: 'ACTIVE' }, `${user.name} activated`)}>
              <UserCheck size={15} /> Activate
            </button>
          ) : (
            <button className={cx(item, 'text-[#B91C1C]')} onClick={() => patch({ status: 'SUSPENDED' }, `${user.name} suspended`, `Suspend ${user.name}? They are signed out everywhere and cannot sign in until activated.`)}>
              <Ban size={15} /> Suspend
            </button>
          )}
          <button className={item} onClick={() => patch({ resetPassword: true }, 'Temporary password issued', `Reset ${user.name}'s password? Their current sessions are signed out.`)}>
            <KeyRound size={15} /> Reset password
          </button>
          <button className={item} onClick={() => patch({ forceSignOut: true }, `${user.name} signed out everywhere`, `Sign ${user.name} out of all devices?`)}>
            <LogOut size={15} /> Force sign-out{user.sessions ? ` · ${user.sessions}` : ''}
          </button>
        </div>
      )}
      {edit && <UserDrawer user={user} options={options} canManage onClose={() => setEdit(false)} />}
      {temp && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 text-[17px] font-bold">Password reset</div>
            <TempPassword password={temp} name={user.name} />
            <button className={cx(btnClass('p'), 'mt-4 w-full')} onClick={() => setTemp(null)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- CSV import
const TEMPLATE_HEAD = ['employeeId', 'name', 'phone', 'role', 'email', 'department', 'designation', 'skills', 'zones', 'shift', 'platformAccess']
type ImportRow = { line: number; data: Record<string, string>; state: 'ready' | 'busy' | 'ok' | 'pending' | 'error'; message?: string; temporaryPassword?: string }

export function ImportCsvButton({ options, canManage }: { options: StaffOptions; canManage: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={btnClass('o')} onClick={() => setOpen(true)}>
        <FileUp size={16} /> Import CSV
      </button>
      {open && <ImportDrawer options={options} canManage={canManage} onClose={() => setOpen(false)} />}
    </>
  )
}

function ImportDrawer({ options, canManage, onClose }: { options: StaffOptions; canManage: boolean; onClose: () => void }) {
  const router = useRouter()
  const [rows, setRows] = useState<ImportRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const norm = (s: string) => s.trim().toLowerCase()
  function load(text: string) {
    setParseError(null)
    const grid = parseCsv(text.replace(/^﻿/, ''))
    if (grid.length < 2) return setParseError('The file needs a header row and at least one user.')
    const head = grid[0].map((h) => h.trim().replace(/\s+/g, '').toLowerCase())
    const need = ['employeeid', 'name', 'phone', 'role']
    const missing = need.filter((n) => !head.includes(n))
    if (missing.length) return setParseError(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`)
    setRows(
      grid.slice(1).map((cells, i) => {
        const data: Record<string, string> = {}
        head.forEach((h, j) => (data[h] = (cells[j] ?? '').trim()))
        return { line: i + 2, data, state: 'ready' }
      }),
    )
  }

  function toBody(d: Record<string, string>) {
    const role = d.role?.toUpperCase().replace(/\s+/g, '_') as Role
    const dept = options.departments.find((x) => norm(x.name) === norm(d.department ?? ''))
    const desig = options.designations.find((x) => norm(x.title) === norm(d.designation ?? ''))
    const list = (s?: string) => (s ? s.split(/[;|]/).map((x) => x.trim()).filter(Boolean) : [])
    const access = list(d.platformaccess?.toLowerCase()).filter((x) => x === 'web' || x === 'app')
    const shift = (d.shift ?? '').toUpperCase()
    return {
      problems: [!ROLES.includes(role) && `unknown role "${d.role}"`, d.department && !dept && `unknown department "${d.department}"`, d.designation && !desig && `unknown designation "${d.designation}"`].filter(Boolean) as string[],
      body: {
        employeeId: d.employeeid,
        name: d.name,
        phone: d.phone,
        role,
        email: d.email ?? '',
        departmentId: dept?._id ?? '',
        designationId: desig?._id ?? '',
        skills: list(d.skills),
        zones: list(d.zones),
        shift: (SHIFTS as readonly string[]).includes(shift) ? shift : 'MORNING',
        ...(access.length ? { platformAccess: access } : {}),
      },
    }
  }

  async function run() {
    setRunning(true)
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.state === 'ok' || r.state === 'pending') continue
      setRows((x) => x.map((y, j) => (j === i ? { ...y, state: 'busy' } : y)))
      const { body, problems } = toBody(r.data)
      let next: Partial<ImportRow>
      if (problems.length) next = { state: 'error', message: problems.join(' · ') }
      else {
        try {
          const res = await api<{ temporaryPassword?: string; pendingApproval?: boolean }>('/users', { body })
          next = { state: res.pendingApproval ? 'pending' : 'ok', temporaryPassword: res.temporaryPassword, message: res.pendingApproval ? 'Created · waiting for approval' : 'Created' }
        } catch (e: any) {
          const f = e?.fields ? Object.entries(e.fields as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(' · ') : ''
          next = { state: 'error', message: f || e?.message || 'Failed' }
        }
      }
      setRows((x) => x.map((y, j) => (j === i ? { ...y, ...next } : y)))
    }
    setRunning(false)
    router.refresh()
  }

  const counts = { ok: rows.filter((r) => r.state === 'ok' || r.state === 'pending').length, err: rows.filter((r) => r.state === 'error').length }
  const hasPasswords = rows.some((r) => r.temporaryPassword)

  return (
    <Drawer
      open
      onClose={onClose}
      width={680}
      title="Import users from CSV"
      sub={canManage ? 'Each row is created as an active user with a temporary password' : 'Rows are created as Pending and wait for a super admin in Approvals'}
      footer={
        <>
          <button type="button" className={btnClass('ghost', 'md')} onClick={() => downloadText('users-template.csv', toCsv([TEMPLATE_HEAD, ['N-0511', 'Shirin Akhter', '01711000511', 'NURSE', 'shirin@unicohospitals.com', 'Nursing', 'Staff Nurse', 'wound_care;injection', 'Dhanmondi;Mohammadpur', 'EVENING', 'app']]))}>
            <Download size={16} /> Template
          </button>
          {hasPasswords && (
            <button
              type="button"
              className={btnClass('ghost', 'md')}
              onClick={() => downloadText('temporary-passwords.csv', toCsv([['employeeId', 'name', 'temporaryPassword'], ...rows.filter((r) => r.temporaryPassword).map((r) => [r.data.employeeid, r.data.name, r.temporaryPassword])]))}
            >
              <KeyRound size={16} /> Passwords
            </button>
          )}
          <div className="flex-1" />
          <button className={btnClass('o')} onClick={onClose}>
            Close
          </button>
          <button className={btnClass('p')} disabled={!rows.length || running || rows.every((r) => r.state === 'ok' || r.state === 'pending')} onClick={run}>
            {running && <Loader2 size={16} className="animate-spin" />}
            Import {rows.filter((r) => r.state !== 'ok' && r.state !== 'pending').length || ''} user{rows.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div
        className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-slate-300 px-4 py-6 text-center hover:border-primary"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault()
          const f = e.dataTransfer.files?.[0]
          if (f) load(await f.text())
        }}
      >
        <FileUp size={22} className="text-primary" />
        <div className="text-sm font-semibold">Choose a .csv file or drop it here</div>
        <div className="text-[12px] text-slate-500">Columns: {TEMPLATE_HEAD.join(', ')} · lists separated with ;</div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) load(await f.text())
          }}
        />
      </div>
      {parseError && <div className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] font-semibold text-[#B91C1C]">{parseError}</div>}
      {rows.length > 0 && (
        <>
          <div className="mb-2 mt-4 flex items-center gap-3 text-[13px] text-slate-500">
            <span className="font-semibold text-slate-900">{rows.length} rows</span>
            {counts.ok > 0 && <span className="text-[#15803D]">{counts.ok} created</span>}
            {counts.err > 0 && <span className="text-[#B91C1C]">{counts.err} failed</span>}
          </div>
          <div className="overflow-hidden rounded-card border border-slate-200">
            {rows.map((r) => (
              <div key={r.line} className="flex items-start gap-3 border-t border-slate-100 px-3.5 py-2.5 text-[13px] first:border-t-0">
                <span className="w-7 flex-none pt-0.5 text-[11px] text-slate-400">#{r.line}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {r.data.name || '—'} <span className="font-normal text-slate-500">· {r.data.employeeid} · {r.data.role} · {r.data.phone}</span>
                  </div>
                  {r.message && <div className={cx('text-[12px]', r.state === 'error' ? 'text-[#B91C1C]' : 'text-slate-500')}>{r.message}</div>}
                  {r.temporaryPassword && (
                    <div className="text-[12px] text-slate-500">
                      Temporary password <code className="rounded bg-[#FEF3C7] px-1.5 font-mono font-bold text-slate-900">{r.temporaryPassword}</code>
                    </div>
                  )}
                </div>
                <span className="flex-none pt-0.5">
                  {r.state === 'busy' ? (
                    <Loader2 size={16} className="animate-spin text-primary" />
                  ) : r.state === 'ok' || r.state === 'pending' ? (
                    <CircleCheck size={16} className={r.state === 'ok' ? 'text-[#16A34A]' : 'text-[#F59E0B]'} />
                  ) : r.state === 'error' ? (
                    <TriangleAlert size={16} className="text-[#DC2626]" />
                  ) : (
                    <span className="text-[11px] text-slate-400">ready</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Drawer>
  )
}
