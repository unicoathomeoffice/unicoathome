'use client'
// Settings → Notification rules: WhatsApp alert groups. Each group picks what it hears about: new requests (built-in
// groups follow a service category; custom groups pick services) and/or the Unico car + claims (built-in Security and
// Transport groups). Each group has people (name, designation, WhatsApp — for new requests optionally limited to some
// services) and can have its own new-request message. Sent from the paired hospital number (lib/services/hod.ts).
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Car, ChevronDown, Loader2, MessageSquareText, Plus, Save, Send, ShieldCheck, Trash2, X } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import { ALERT_EVENTS, ALERT_EVENT_LABEL, type AlertEvent } from '@/lib/constants'

type Group = { id: string; name: string; category?: string; services: 'ALL' | string[]; message?: string; active: boolean; events?: AlertEvent[]; system?: 'security' | 'transport' }
type Contact = { id: string; groupId: string; name: string; designation: string; phone: string; services?: string[]; active: boolean }
type Svc = { code: string; name: string; category: string }

const newId = () => Math.random().toString(36).slice(2, 10)
/** groups saved before events existed hear about new requests only (same rule as lib/services/hod.ts eventsOf) */
const eventsOf = (g: Group): AlertEvent[] => (g.events?.length ? g.events : ['NEW_REQUEST'])
const digits = (s: string) => s.replace(/\D/g, '')
const problem = (c: Contact) => (c.name.trim().length < 2 ? 'name' : c.designation.trim().length < 2 ? 'designation' : digits(c.phone).length < 10 ? 'phone' : null)
const PLACEHOLDERS = '{staffName} {designation} {requestNo} {priority} {serviceType} {patientName} {age} {gender} {patientPhone} {address} {date} {slot} {requestLink}'

export function HodContacts({ initial, services, wa }: { initial: { enabled: boolean; groups: Group[]; contacts: Contact[] }; services: Svc[]; wa: { paired: boolean; phone: string | null } }) {
  const router = useRouter()
  const toast = useToast()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [groups, setGroups] = useState<Group[]>(initial.groups)
  const [list, setList] = useState<Contact[]>(initial.contacts)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [msgOpen, setMsgOpen] = useState<string | null>(null)
  const [svcOpen, setSvcOpen] = useState<string | null>(null)
  const dirty = enabled !== initial.enabled || JSON.stringify(groups) !== JSON.stringify(initial.groups) || JSON.stringify(list) !== JSON.stringify(initial.contacts)
  const invalid = list.filter((c) => problem(c))

  const updG = (id: string, p: Partial<Group>) => setGroups((g) => g.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const upd = (id: string, p: Partial<Contact>) => setList((l) => l.map((c) => (c.id === id ? { ...c, ...p } : c)))
  /** services a group covers (codes) — for chips and the per-person picker */
  const groupCodes = (g: Group) => (g.services === 'ALL' ? services.map((s) => s.code) : g.category ? services.filter((s) => s.category.toLowerCase() === g.category!.toLowerCase()).map((s) => s.code) : g.services)
  const svcName = (code: string) => services.find((s) => s.code === code)?.name ?? code

  async function save() {
    if (invalid.length) {
      setShowErrors(true)
      return toast('Fill in name, designation and a full mobile number for everyone', 'err')
    }
    if (groups.some((g) => g.name.trim().length < 2)) return toast('Give every group a name', 'err')
    setBusy(true)
    try {
      await api('/settings', {
        method: 'PATCH',
        body: { key: 'hodAlerts', value: { enabled, groups: groups.map((g) => ({ ...g, name: g.name.trim(), message: g.message?.trim() || undefined })), contacts: list.map((c) => ({ ...c, name: c.name.trim(), designation: c.designation.trim(), phone: c.phone.trim(), services: c.services?.length ? c.services : undefined })) } },
      })
      toast('Alert groups saved', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  async function test(c: Contact) {
    setTesting(c.id)
    try {
      const r = await api<{ to: string }>('/settings', { body: { test: 'hod', to: c.phone, name: c.name } })
      toast(`Test WhatsApp queued to +${r.to}`, 'ok')
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setTesting(null)
    }
  }
  function removeGroup(g: Group) {
    const n = list.filter((c) => c.groupId === g.id).length
    if (n && !confirm(`Remove "${g.name}" and its ${n} ${n === 1 ? 'person' : 'people'}?`)) return
    setGroups((x) => x.filter((y) => y.id !== g.id))
    setList((x) => x.filter((c) => c.groupId !== g.id))
  }

  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-bold">Alert groups — department heads, security &amp; transport</h2>
          <p className="text-[13px] text-slate-500">
            Each group gets a WhatsApp for what it is set to hear about. New requests go to the groups that cover one of the request’s services (patient, service, address, time and a link to assign it). Security and Transport hear about the Unico car — requested, allotted with the requisition and gate pass, time changed, cancelled, leaving and back at the hospital — and expense claims.
          </p>
        </div>
        <Toggle on={enabled} onChange={setEnabled} label="Send group alerts" />
      </div>
      <div className={cx('mt-3 rounded-lg px-3 py-2 text-[13px]', wa.paired ? 'bg-[#F0FDF4] text-[#15803D]' : 'bg-[#FEF3C7] text-[#92400E]')}>
        {wa.paired ? (
          <>WhatsApp paired{wa.phone ? ` as +${wa.phone}` : ''} — alerts are sent automatically.</>
        ) : (
          <>
            WhatsApp is not paired — alerts won’t send.{' '}
            <Link href="/settings#whatsapp" className="font-semibold underline">
              Pair it in Settings → WhatsApp
            </Link>
          </>
        )}
      </div>

      <div className={cx('mt-4 grid gap-4 xl:grid-cols-2', !enabled && 'opacity-60')}>
        {groups.map((g) => {
          const rows = list.filter((c) => c.groupId === g.id)
          const codes = groupCodes(g)
          return (
            <div key={g.id} className={cx('flex flex-col rounded-xl border border-slate-200 p-3.5', !g.active && 'opacity-60')}>
              <div className="flex items-center gap-2">
                {g.system && (
                  <span className={cx('flex size-9 flex-none items-center justify-center rounded-lg', g.system === 'security' ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-primary-50 text-primary-700')} title={g.system === 'security' ? 'Built-in security group' : 'Built-in transport group'}>
                    {g.system === 'security' ? <ShieldCheck size={18} /> : <Car size={18} />}
                  </span>
                )}
                <input className="hc-input h-9 min-w-0 flex-1 font-bold" value={g.name} onChange={(e) => updG(g.id, { name: e.target.value })} aria-label="Group name" />
                <span className="whitespace-nowrap text-[12px] text-slate-500">{rows.filter((r) => r.active).length} active</span>
                <Toggle on={g.active} onChange={(v) => updG(g.id, { active: v })} label={`${g.name} active`} />
                {!g.category && !g.system && (
                  <button type="button" onClick={() => removeGroup(g)} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-[#B91C1C]" title="Remove group">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>

              {/* what this group hears about */}
              <div className="mt-2">
                <div className="text-[12px] font-semibold text-slate-600">Alert about</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {ALERT_EVENTS.map((ev) => {
                    const on = eventsOf(g).includes(ev)
                    return (
                      <button
                        key={ev}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          const cur = eventsOf(g)
                          const next = on ? cur.filter((x) => x !== ev) : [...cur, ev]
                          if (!next.length) return toast('A group needs at least one alert', 'err')
                          updG(g.id, { events: ALERT_EVENTS.filter((x) => next.includes(x)) })
                        }}
                        className={cx('rounded-full border px-2 py-0.5 text-[11.5px]', on ? 'border-primary bg-primary-50 font-semibold text-primary-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50')}
                      >
                        {ALERT_EVENT_LABEL[ev]}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* services that trigger this group (new requests only) */}
              {eventsOf(g).includes('NEW_REQUEST') && (
                <div className="mt-2">
                  <button type="button" onClick={() => setSvcOpen(svcOpen === g.id ? null : g.id)} className="flex w-full items-center gap-1.5 text-left text-[12px] font-semibold text-slate-600">
                    <ChevronDown size={14} className={cx('transition-transform', svcOpen === g.id && 'rotate-180')} />
                    {g.category ? `All ${g.category === 'Lab' ? 'lab' : g.category.toLowerCase()} services` : g.services === 'ALL' ? 'All services' : `${codes.length} service${codes.length === 1 ? '' : 's'}`}
                    {!g.category && <span className="font-normal text-slate-400">· tap to choose</span>}
                  </button>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(svcOpen === g.id && !g.category ? services.map((s) => s.code) : codes).map((code) => {
                      const on = g.services === 'ALL' || codes.includes(code)
                      return svcOpen === g.id && !g.category ? (
                        <button
                          key={code}
                          type="button"
                          onClick={() => {
                            const cur = g.services === 'ALL' ? services.map((s) => s.code) : g.services
                            updG(g.id, { services: on ? cur.filter((c) => c !== code) : [...cur, code] })
                          }}
                          className={cx('rounded-full border px-2 py-0.5 text-[11.5px]', on ? 'border-primary bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-500')}
                        >
                          {svcName(code)}
                        </button>
                      ) : (
                        <span key={code} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                          {svcName(code)}
                        </span>
                      )
                    })}
                    {svcOpen === g.id && !g.category && (
                      <button type="button" onClick={() => updG(g.id, { services: g.services === 'ALL' ? [] : 'ALL' })} className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11.5px] font-semibold text-slate-600">
                        {g.services === 'ALL' ? 'Clear all' : 'All services'}
                      </button>
                    )}
                    {!codes.length && svcOpen !== g.id && <span className="text-[11.5px] text-[#B45309]">No services chosen — nobody in this group will hear about new requests</span>}
                  </div>
                </div>
              )}

              {/* own message (new requests) */}
              {eventsOf(g).includes('NEW_REQUEST') && (
                <div className="mt-2">
                  <button type="button" onClick={() => setMsgOpen(msgOpen === g.id ? null : g.id)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary-700 hover:underline">
                    <MessageSquareText size={13} /> {g.message?.trim() ? 'Own message (edit)' : 'Use own message'}
                  </button>
                  {msgOpen === g.id && (
                    <div className="mt-1.5">
                      <textarea className="hc-input text-[13px]" rows={4} value={g.message ?? ''} onChange={(e) => updG(g.id, { message: e.target.value })} placeholder="Leave empty to use the shared “New request → head of department” template" />
                      <div className="mt-1 text-[11px] leading-[16px] text-slate-400">Placeholders: {PLACEHOLDERS}</div>
                    </div>
                  )}
                </div>
              )}
              {!eventsOf(g).includes('NEW_REQUEST') && (
                <div className="mt-2 text-[11.5px] text-slate-500">
                  Messages: the “Car … → Security / Transport” templates in{' '}
                  <Link href="/settings/templates" className="font-semibold text-primary-700 hover:underline">
                    Templates
                  </Link>
                  . PDFs (requisition, gate pass, claims) are sent as files.
                </div>
              )}

              <div className="mt-3 flex flex-col gap-2">
                {rows.map((c) => {
                  const bad = showErrors ? problem(c) : null
                  return (
                    <div key={c.id} className={cx('rounded-lg bg-slate-50 p-2.5', !c.active && 'opacity-60')}>
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_150px_auto]">
                        <input className={cx('hc-input h-9', bad === 'name' && 'border-[#DC2626]')} placeholder="Name" value={c.name} onChange={(e) => upd(c.id, { name: e.target.value })} aria-label="Name" />
                        <input className={cx('hc-input h-9', bad === 'designation' && 'border-[#DC2626]')} placeholder="Designation" value={c.designation} onChange={(e) => upd(c.id, { designation: e.target.value })} aria-label="Designation" />
                        <input className={cx('hc-input h-9', bad === 'phone' && 'border-[#DC2626]')} placeholder="WhatsApp 01XXXXXXXXX" inputMode="tel" value={c.phone} onChange={(e) => upd(c.id, { phone: e.target.value })} aria-label="WhatsApp number" />
                        <div className="flex items-center gap-1.5">
                          <Toggle on={c.active} onChange={(v) => upd(c.id, { active: v })} label={`${c.name || 'Person'} active`} />
                          <button type="button" title="Send a test WhatsApp" disabled={!wa.paired || testing === c.id || digits(c.phone).length < 10} onClick={() => test(c)} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-primary-700 disabled:opacity-40">
                            {testing === c.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                          </button>
                          <button type="button" title="Remove" onClick={() => setList((l) => l.filter((x) => x.id !== c.id))} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-[#B91C1C]">
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                      {/* optional: only some of the group's services */}
                      {eventsOf(g).includes('NEW_REQUEST') && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <span className="text-[11.5px] text-slate-500">{c.services?.length ? 'Only:' : 'All group services ·'}</span>
                          {c.services?.length
                            ? c.services.map((code) => (
                                <button key={code} type="button" onClick={() => upd(c.id, { services: c.services!.filter((x) => x !== code) })} className="rounded-full border border-primary bg-primary-50 px-2 py-0.5 text-[11px] text-primary-700" title="Remove">
                                  {svcName(code)} ×
                                </button>
                              ))
                            : null}
                          <select className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[11.5px] text-slate-600" value="" onChange={(e) => e.target.value && upd(c.id, { services: [...(c.services ?? []), e.target.value] })} aria-label="Limit to a service">
                            <option value="">{c.services?.length ? '+ add service' : 'limit to…'}</option>
                            {codes.filter((code) => !c.services?.includes(code)).map((code) => (
                              <option key={code} value={code}>
                                {svcName(code)}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )
                })}
                <button type="button" onClick={() => setList((l) => [...l, { id: newId(), groupId: g.id, name: '', designation: '', phone: '', active: true }])} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-slate-300 text-[13px] font-semibold text-primary-700 hover:bg-primary-50">
                  <Plus size={15} /> Add person
                </button>
              </div>
            </div>
          )
        })}
        <button type="button" onClick={() => setGroups((g) => [...g, { id: newId(), name: 'New group', services: [], events: ['NEW_REQUEST'], active: true }])} className="flex min-h-[120px] flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-slate-300 text-[14px] font-semibold text-primary-700 hover:bg-primary-50">
          <Plus size={20} /> Add group
          <span className="text-[12px] font-normal text-slate-500">e.g. Radiology, Management, Night duty</span>
        </button>
      </div>
      <button type="button" onClick={save} disabled={busy || !dirty} className={btnClass('p', 'md', 'mt-4')}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save alert groups
      </button>
    </section>
  )
}
