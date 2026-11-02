'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, KeyRound, Loader2, ShieldCheck, Clock } from 'lucide-react'
import { api, ChipPicker, Drawer, Segmented, useToast } from '@/components/client'
import { ApiClientError } from '@/components/client/api'
import { btnClass } from '@/components/ui'
import { AVAILABILITY, AVAILABILITY_LABEL, ROLE_LABEL, SHIFTS, SKILLS, defaultPlatformAccess, type Role } from '@/lib/constants'
import { CheckPill, Field, FormError, useFieldErrors } from './form'
import { PhotoPicker } from '@/components/client/PhotoPicker'
import { cx } from '@/lib/format'

export type StaffOptions = {
  departments: { _id: string; name: string }[]
  designations: { _id: string; title: string; departmentId?: string }[]
  zones: string[]
  vehicles: { _id: string; name: string; plate: string; driverId?: string }[]
  customRoles?: { _id: string; name: string; code: string; baseRole: string }[]
  supervisors: { _id: string; name: string }[]
}

export type StaffUser = {
  _id: string
  employeeId: string
  name: string
  photoUrl?: string
  username?: string
  phone: string
  whatsapp?: string
  email?: string
  role: Role
  roles?: Role[]
  departmentId?: string
  designationId?: string
  skills?: string[]
  zones?: string[]
  platformAccess?: ('web' | 'app')[]
  shift?: string
  status?: string
  availability?: string
  vehicleId?: string
  supervisorId?: string
  licenceNo?: string
  licenceExpiry?: string
}

const SHIFT_LABEL: Record<string, string> = { MORNING: 'Morning', EVENING: 'Evening', NIGHT: 'Night', FLEX: 'Flexible' }

/** What each role is for — shown on the role cards so nobody has to guess what ALLIED means. */
const ROLE_HINT: Record<Role, string> = {
  DOCTOR: 'Home visits as doctor',
  NURSE: 'Nursing visits',
  ALLIED: 'Phlebotomist, physio, lab, technician',
  DRIVER: 'Drives the Unico car',
  TRANSPORT_SUPERVISOR: 'Allots cars and drivers',
  HC_ADMIN: 'Takes requests, assigns staff',
  FRONT_DESK: 'Registers patients and requests',
  VIEWER: 'Reports and dashboards only',
  SUPER_ADMIN: 'Everything, incl. users and settings',
}
const ROLE_ORDER: Role[] = ['DOCTOR', 'NURSE', 'ALLIED', 'DRIVER', 'TRANSPORT_SUPERVISOR', 'HC_ADMIN', 'FRONT_DESK', 'VIEWER', 'SUPER_ADMIN']

/** Best guess of the role from the designation title (then the department name). */
export function suggestRole(designation?: string, department?: string): Role | null {
  const t = (designation ?? '').toLowerCase()
  if (t) {
    if (/phlebotom|physio|lab|technolog|technician|pharm|dietit|therap|radiograph|sonograph|allied/.test(t)) return 'ALLIED'
    if (/driver/.test(t)) return 'DRIVER'
    if (/security|transport|car supervisor|fleet/.test(t)) return 'TRANSPORT_SUPERVISOR'
    if (/coordinat/.test(t)) return 'HC_ADMIN'
    if (/front ?desk|reception|customer/.test(t)) return 'FRONT_DESK'
    if (/nurs|sister|brother|midwi|matron/.test(t)) return 'NURSE'
    if (/doctor|consultant|registrar|medical officer|\brmo\b|\bmo\b|physician|specialist|surgeon|\bdr\b/.test(t)) return 'DOCTOR'
  }
  const d = (department ?? '').toLowerCase()
  if (/nurs/.test(d)) return 'NURSE'
  if (/lab|patholog|physio|rehab|radiolog|imaging|pharm/.test(d)) return 'ALLIED'
  if (/transport|security|fleet/.test(d)) return 'TRANSPORT_SUPERVISOR'
  if (/medicine|doctor|medical|cardio|pediatr|paediatr|surgery|gyn/.test(d)) return 'DOCTOR'
  return null
}
export const skillLabel = (s: string) => s

/** Shown once after create / reset: the temporary password */
export function TempPassword({ password, name }: { password: string; name?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-card border border-[#FDE68A] bg-[#FFFBEB] p-4">
      <div className="flex items-center gap-2 text-[13px] font-bold text-[#B45309]">
        <KeyRound size={16} /> Temporary password{name ? ` for ${name}` : ''}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 rounded-lg border border-[#FDE68A] bg-white px-3 py-2 font-mono text-[17px] font-bold tracking-wider">{password}</code>
        <button
          type="button"
          className={btnClass('o', 'md')}
          onClick={async () => {
            await navigator.clipboard?.writeText(password).catch(() => {})
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="mt-2 text-[12px] text-[#92400E]">Shown only once. Share it privately — they will be asked to change it at first sign-in.</div>
    </div>
  )
}

function initial(u?: StaffUser) {
  const role: Role = u?.role ?? 'NURSE'
  return {
    employeeId: u?.employeeId ?? '',
    name: u?.name ?? '',
    username: u?.username ?? '',
    phone: u?.phone ?? '',
    whatsapp: u?.whatsapp && u.whatsapp !== u.phone ? u.whatsapp : '',
    email: u?.email ?? '',
    role,
    roles: (u?.roles ?? []).filter((r) => r !== role) as Role[],
    customRoleId: (u as any)?.customRoleId ?? '',
    departmentId: u?.departmentId ?? '',
    designationId: u?.designationId ?? '',
    skills: u?.skills ?? [],
    zones: u?.zones ?? [],
    platformAccess: (u?.platformAccess ?? defaultPlatformAccess(role)) as ('web' | 'app')[],
    shift: u?.shift ?? 'MORNING',
    status: u?.status ?? 'ACTIVE',
    availability: u?.availability ?? 'ON_DUTY',
    vehicleId: u?.vehicleId ?? '',
    supervisorId: u?.supervisorId ?? '',
    licenceNo: u?.licenceNo ?? '',
    licenceExpiry: u?.licenceExpiry ? String(u.licenceExpiry).slice(0, 10) : '',
    pwMode: 'generate' as 'generate' | 'set',
    password: '',
  }
}

/**
 * Add / edit user drawer (W09 + A1). Only SUPER_ADMIN (users.manage) creates active users or edits;
 * a coordinator's new user is created PENDING and waits in Approvals.
 */
export function UserDrawer({ user, options, canManage, onClose, presetRole }: { user?: StaffUser; options: StaffOptions; canManage: boolean; onClose: () => void; presetRole?: Role }) {
  const router = useRouter()
  const toast = useToast()
  const editing = !!user
  const readOnly = editing && !canManage
  const [v, setV] = useState(() => {
    const s = initial(user)
    if (!user && presetRole) {
      s.role = presetRole
      s.platformAccess = defaultPlatformAccess(presetRole)
    }
    return s
  })
  const [accessTouched, setAccessTouched] = useState(editing)
  // a new user starts with no role picked (it used to silently default to NURSE); the designation suggests one
  const [roleSet, setRoleSet] = useState(editing || !!presetRole)
  const [roleTouched, setRoleTouched] = useState(editing || !!presetRole)
  const [roleSuggested, setRoleSuggested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<null | { temporaryPassword?: string; pendingApproval?: boolean; name: string }>(null)
  const fe = useFieldErrors()
  const err = (k: string) => fe.errors[k]
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }))

  const desigs = useMemo(() => {
    const inDept = options.designations.filter((d) => !v.departmentId || d.departmentId === v.departmentId)
    return inDept.length ? inDept : options.designations
  }, [options.designations, v.departmentId])
  const isDriver = v.role === 'DRIVER'
  const isField = ['DOCTOR', 'NURSE', 'ALLIED'].includes(v.role)
  const defaults = defaultPlatformAccess(v.role)

  function setRole(role: Role, by: 'user' | 'suggest' = 'user') {
    setRoleSet(true)
    if (by === 'user') setRoleTouched(true)
    setRoleSuggested(by === 'suggest')
    setV((s) => ({ ...s, role, roles: s.roles.filter((r) => r !== role), platformAccess: accessTouched ? s.platformAccess : defaultPlatformAccess(role) }))
  }
  /** Department / designation changed: suggest the role until someone picks one by hand. */
  function suggestFrom(departmentId: string, designationId: string) {
    if (roleTouched) return
    const title = options.designations.find((d) => d._id === designationId)?.title
    const dept = options.departments.find((d) => d._id === departmentId)?.name
    const r = suggestRole(title, dept)
    if (r) setRole(r, 'suggest')
  }
  function toggleAccess(k: 'web' | 'app', on: boolean) {
    setAccessTouched(true)
    setV((s) => ({ ...s, platformAccess: on ? [...new Set([...s.platformAccess, k])] : s.platformAccess.filter((x) => x !== k) }))
  }

  async function save() {
    fe.clear()
    if (!roleSet) {
      fe.fromError(new ApiClientError('Pick a role for this user', 400, 'VALIDATION', { role: 'Pick a role' }))
      return
    }
    if (!v.platformAccess.length) {
      fe.fromError(new Error('Give at least Web or App access'))
      return
    }
    setBusy(true)
    const body: Record<string, unknown> = {
      employeeId: v.employeeId.trim(),
      name: v.name.trim(),
      username: v.username.trim() || undefined,
      phone: v.phone.trim(),
      whatsapp: v.whatsapp.trim() || v.phone.trim(),
      email: v.email.trim(),
      role: v.role,
      roles: v.roles.filter((r) => r !== v.role),
      customRoleId: v.customRoleId,
      departmentId: v.departmentId,
      designationId: v.designationId,
      skills: v.skills,
      zones: v.zones,
      platformAccess: v.platformAccess,
      shift: v.shift,
      status: v.status,
      availability: v.availability,
      vehicleId: isDriver ? v.vehicleId : '',
      supervisorId: isDriver ? v.supervisorId : '',
      licenceNo: isDriver ? v.licenceNo.trim() || undefined : undefined,
      licenceExpiry: isDriver ? v.licenceExpiry || undefined : undefined,
    }
    if (v.pwMode === 'set' && v.password) body.password = v.password
    try {
      if (editing) {
        const r = await api<{ temporaryPassword?: string }>(`/users/${user!._id}`, { method: 'PATCH', body })
        // moving a driver to another car (or none): free the old car
        const old = options.vehicles.find((c) => c.driverId === user!._id)
        if (old && old._id !== (isDriver ? v.vehicleId : '')) await api(`/master/vehicles/${old._id}`, { method: 'PATCH', body: { driverId: '' } }).catch(() => {})
        toast('User updated')
        router.refresh()
        if (r.temporaryPassword) setDone({ temporaryPassword: r.temporaryPassword, name: v.name })
        else onClose()
      } else {
        if (!editing && !isDriver) {
          delete body.vehicleId
          delete body.supervisorId
        }
        const r = await api<{ id: string; temporaryPassword?: string; pendingApproval?: boolean }>('/users', { body })
        toast(r.pendingApproval ? 'Submitted for approval' : 'User created')
        router.refresh()
        setDone({ temporaryPassword: r.temporaryPassword, pendingApproval: r.pendingApproval, name: v.name })
      }
    } catch (e) {
      fe.fromError(e)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Drawer open onClose={onClose} title={done.pendingApproval ? 'Submitted for approval' : editing ? 'Saved' : 'User created'} sub={done.name} footer={<button className={cx(btnClass('p'), 'ml-auto')} onClick={onClose}>Done</button>}>
        {done.pendingApproval ? (
          <div className="mb-4 flex gap-3 rounded-card bg-[#FEF3C7] p-4 text-[13px] text-[#92400E]">
            <Clock size={18} className="mt-0.5 flex-none" />
            <div>
              <div className="font-bold">Waiting for a super admin</div>
              {done.name} is saved as <b>Pending</b> and cannot sign in until a super admin approves the request in Settings → Approvals.
            </div>
          </div>
        ) : (
          <div className="mb-4 flex gap-3 rounded-card bg-[#DCFCE7] p-4 text-[13px] text-[#166534]">
            <ShieldCheck size={18} className="mt-0.5 flex-none" />
            <div>
              <div className="font-bold">Account is active</div>
              {done.name} can sign in with their employee ID or phone number.
            </div>
          </div>
        )}
        {done.temporaryPassword ? <TempPassword password={done.temporaryPassword} name={done.name} /> : <div className="text-[13px] text-slate-500">The password you set is active.</div>}
      </Drawer>
    )
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width={600}
      title={readOnly ? user!.name : editing ? `Edit ${user!.name}` : 'Add user'}
      sub={readOnly ? 'View only — a super admin can change users' : 'Everything the person needs to log in and be assignable'}
      footer={
        readOnly ? (
          <button className={cx(btnClass('o'), 'ml-auto')} onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            {!canManage && !editing && <span className="text-[12px] text-slate-500">Goes to Approvals</span>}
            <div className="flex-1" />
            <button className={btnClass('o')} onClick={onClose}>
              Cancel
            </button>
            <button className={btnClass('p')} onClick={save} disabled={busy}>
              {busy && <Loader2 size={16} className="animate-spin" />}
              {editing ? 'Save changes' : canManage ? 'Create user' : 'Submit for approval'}
            </button>
          </>
        )
      }
    >
      <FormError message={fe.message} />
      {editing && user && canManage && (
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-slate-50 px-3.5 py-3">
          <PhotoPicker endpoint={`/users/${user._id}/photo`} photo={user.photoUrl} name={user.name} size={56} />
          <div className="text-[12.5px] text-slate-500">Profile photo — shown next to {user.name.split(' ')[0]}’s name across the app and to patients in their care team.</div>
        </div>
      )}
      {!canManage && !editing && (
        <div className="mb-4 rounded-lg bg-primary-50 px-3.5 py-2.5 text-[13px] text-primary-700">Only a super admin can create active users. This user will be saved as <b>Pending</b> and appear in Approvals.</div>
      )}
      <fieldset disabled={readOnly} className="grid grid-cols-2 gap-x-3 gap-y-3.5">
        <Field label="Full name" error={err('name')}>
          <input className="hc-input" value={v.name} onChange={set('name')} placeholder="Shirin Akhter" autoFocus={!editing} />
        </Field>
        <Field label="Employee ID" error={err('employeeId')}>
          <input className="hc-input" value={v.employeeId} onChange={set('employeeId')} placeholder="N-0511" />
        </Field>
        <Field label="Phone (login + WhatsApp)" error={err('phone')}>
          <input className="hc-input" value={v.phone} onChange={set('phone')} placeholder="01711-000000" inputMode="tel" />
        </Field>
        <Field label="Username (optional)" error={err('username')}>
          <input className="hc-input" value={v.username} onChange={set('username')} placeholder="shirin" />
        </Field>
        <Field label="Email (optional)" error={err('email')}>
          <input className="hc-input" type="email" value={v.email} onChange={set('email')} placeholder="name@unicohospitals.com" />
        </Field>
        <Field label="Different WhatsApp no. (optional)" error={err('whatsapp')}>
          <input className="hc-input" value={v.whatsapp} onChange={set('whatsapp')} placeholder="Same as phone" inputMode="tel" />
        </Field>
        <Field label="Department" error={err('departmentId')}>
          <select
            className="hc-input"
            value={v.departmentId}
            onChange={(e) => {
              setV((s) => ({ ...s, departmentId: e.target.value, designationId: '' }))
              suggestFrom(e.target.value, '')
            }}
          >
            <option value="">—</option>
            {options.departments.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Designation" error={err('designationId')}>
          <select
            className="hc-input"
            value={v.designationId}
            onChange={(e) => {
              setV((s) => ({ ...s, designationId: e.target.value }))
              suggestFrom(v.departmentId, e.target.value)
            }}
          >
            <option value="">—</option>
            {desigs.map((d) => (
              <option key={d._id} value={d._id}>
                {d.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="col-span-2">
          <span className="hc-label">Role</span>
          <div>
            <div role="radiogroup" aria-label="Role" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ROLE_ORDER.filter((r) => r !== 'SUPER_ADMIN' || canManage || v.role === 'SUPER_ADMIN').map((r) => {
                const on = roleSet && v.role === r
                return (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setRole(r)}
                    className={cx(
                      'flex min-h-[52px] flex-col items-start justify-center rounded-lg border-[1.5px] px-3 py-2 text-left transition-colors',
                      on ? 'border-primary bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                      {on && <Check size={14} />} {ROLE_LABEL[r]}
                    </span>
                    <span className={cx('text-[11.5px] leading-snug', on ? 'text-primary-700/80' : 'text-slate-500')}>{ROLE_HINT[r]}</span>
                  </button>
                )
              })}
            </div>
            {err('role') ? (
              <span className="mt-1 block text-[12px] font-semibold text-[#B91C1C]">{err('role')}</span>
            ) : (
              <span className="mt-1 block text-[12px] text-slate-500">{roleSuggested ? 'Suggested from the designation — pick another if needed' : 'Decides what they can do and where they appear for assignment'}</span>
            )}
          </div>
        </div>
        <Field label="Also acts as (optional)" hint="Extra roles: permissions, notifications and assignment candidates include all of them">
          <ChipPicker
            options={ROLE_ORDER.filter((r) => r !== v.role && r !== 'SUPER_ADMIN').map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
            value={v.roles}
            onChange={(roles) => setV((x) => ({ ...x, roles: roles as Role[] }))}
          />
        </Field>
        {!!options.customRoles?.length && (
          <Field label="Custom role (optional)" error={err('customRoleId')} hint="Overrides the base role's permissions">
            <select className="hc-input" value={v.customRoleId} onChange={set('customRoleId')}>
              <option value="">None · use {v.role} permissions</option>
              {options.customRoles.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Shift" error={err('shift')}>
          <select className="hc-input" value={v.shift} onChange={set('shift')}>
            {SHIFTS.map((s) => (
              <option key={s} value={s}>
                {SHIFT_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>

        {isDriver && (
          <div className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-3 rounded-card border border-[#FED7AA] bg-[#FFF7ED] p-4">
            <div className="col-span-2 text-[13px] font-bold text-[#C2410C]">Driver details</div>
            <Field label="Assigned car" error={err('vehicleId')}>
              <select className="hc-input" value={v.vehicleId} onChange={set('vehicleId')}>
                <option value="">No car</option>
                {options.vehicles.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name} · {c.plate}
                    {c.driverId && c.driverId !== user?._id ? ' (has a driver)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reports to" error={err('supervisorId')}>
              <select className="hc-input" value={v.supervisorId} onChange={set('supervisorId')}>
                <option value="">—</option>
                {options.supervisors.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name} · Car supervisor
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Driving licence no." error={err('licenceNo')}>
              <input className="hc-input" value={v.licenceNo} onChange={set('licenceNo')} placeholder="DK-0482-2019" />
            </Field>
            <Field label="Licence expiry" error={err('licenceExpiry')}>
              <input className="hc-input" type="date" value={v.licenceExpiry} onChange={set('licenceExpiry')} />
            </Field>
          </div>
        )}

        <div className="col-span-2">
          <span className="hc-label">Platform access</span>
          <div className="flex flex-wrap items-center gap-2.5">
            <CheckPill on={v.platformAccess.includes('web')} onChange={(x) => toggleAccess('web', x)} disabled={readOnly}>
              Web
            </CheckPill>
            <CheckPill on={v.platformAccess.includes('app')} onChange={(x) => toggleAccess('app', x)} disabled={readOnly}>
              App
            </CheckPill>
            <span className="text-[12.5px] text-slate-500">
              Default for {v.role}: {defaults.map((d) => (d === 'web' ? 'Web' : 'App')).join(' + ')}
              {defaults.length === 1 ? ' only' : ''}
            </span>
          </div>
          {err('platformAccess') && <span className="mt-1 block text-[12px] font-semibold text-[#B91C1C]">{err('platformAccess')}</span>}
        </div>

        {(isField || v.skills.length > 0) && (
          <div className="col-span-2">
            <span className="hc-label">Skills</span>
            {readOnly ? (
              <div className="text-sm text-slate-700">{v.skills.join(', ') || '—'}</div>
            ) : (
              <ChipPicker options={SKILLS} value={v.skills} onChange={(skills) => setV((s) => ({ ...s, skills }))} />
            )}
          </div>
        )}
        {(isField || isDriver || v.zones.length > 0) && (
          <div className="col-span-2">
            <span className="hc-label">Zones</span>
            {readOnly ? (
              <div className="text-sm text-slate-700">{v.zones.join(', ') || '—'}</div>
            ) : (
              <ChipPicker options={[...new Set([...options.zones, ...v.zones])]} value={v.zones} onChange={(zones) => setV((s) => ({ ...s, zones }))} />
            )}
          </div>
        )}

        <Field label="Status" error={err('status')}>
          <select className="hc-input" value={v.status} onChange={set('status')} disabled={!canManage}>
            <option value="ACTIVE">{canManage ? 'Active' : 'Pending approval'}</option>
            {user?.status === 'PENDING' && <option value="PENDING">Pending approval</option>}
            <option value="SUSPENDED">Suspended</option>
          </select>
        </Field>
        <Field label="Availability" error={err('availability')}>
          <select className="hc-input" value={v.availability} onChange={set('availability')}>
            {AVAILABILITY.map((a) => (
              <option key={a} value={a}>
                {AVAILABILITY_LABEL[a]}
              </option>
            ))}
          </select>
        </Field>

        {!readOnly && (
          <div className="col-span-2 rounded-card bg-slate-50 p-4">
            <span className="hc-label">{editing ? 'Password' : 'First sign-in'}</span>
            <Segmented
              value={v.pwMode}
              onChange={(pwMode) => setV((s) => ({ ...s, pwMode }))}
              items={[
                { value: 'generate', label: editing ? 'Keep current password' : 'Generate temporary password' },
                { value: 'set', label: editing ? 'Set a new password' : 'Set a password' },
              ]}
            />
            {v.pwMode === 'set' ? (
              <Field label="Password" error={err('password')} hint="At least 8 characters" className="mt-3">
                <input className="hc-input" type="text" autoComplete="new-password" value={v.password} onChange={set('password')} />
              </Field>
            ) : (
              <div className="mt-2 text-[12.5px] text-slate-500">{editing ? 'Use “Reset password” in the row menu to issue a temporary password.' : 'A temporary password is shown once after saving; the user must change it at first sign-in.'}</div>
            )}
          </div>
        )}
      </fieldset>
    </Drawer>
  )
}
