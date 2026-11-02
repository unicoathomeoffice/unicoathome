'use client'
// Settings → Notification rules: heads of department who get a WhatsApp when a new request for their service
// comes in (lib/services/requests.ts notifyHods). Several people per service; sent from the paired hospital number.
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Save, Send, X } from 'lucide-react'
import { api, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

type Category = 'Doctor' | 'Nursing' | 'Lab' | 'Physio'
type Contact = { id: string; category: Category; name: string; designation: string; phone: string; active: boolean }

const SECTIONS: { key: Category; title: string }[] = [
  { key: 'Doctor', title: 'Doctor service' },
  { key: 'Nursing', title: 'Nursing service' },
  { key: 'Lab', title: 'Phlebotomy / Lab' },
  { key: 'Physio', title: 'Physiotherapy' },
]
const newId = () => Math.random().toString(36).slice(2, 10)
const digits = (s: string) => s.replace(/\D/g, '')
const problem = (c: Contact) => (c.name.trim().length < 2 ? 'name' : c.designation.trim().length < 2 ? 'designation' : digits(c.phone).length < 10 ? 'phone' : null)

export function HodContacts({
  initial,
  services,
  wa,
}: {
  initial: { enabled: boolean; contacts: Contact[] }
  /** active service names per category, so admins see which services trigger each list */
  services: Record<string, string[]>
  wa: { paired: boolean; phone: string | null }
}) {
  const router = useRouter()
  const toast = useToast()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [list, setList] = useState<Contact[]>(initial.contacts)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const dirty = enabled !== initial.enabled || JSON.stringify(list) !== JSON.stringify(initial.contacts)
  const invalid = list.filter((c) => problem(c))

  const upd = (id: string, patch: Partial<Contact>) => setList((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c)))

  async function save() {
    if (invalid.length) {
      setShowErrors(true)
      toast('Fill in name, designation and a full mobile number for everyone', 'err')
      return
    }
    setBusy(true)
    try {
      await api('/settings', { method: 'PATCH', body: { key: 'hodAlerts', value: { enabled, contacts: list.map((c) => ({ ...c, name: c.name.trim(), designation: c.designation.trim(), phone: c.phone.trim() })) } } })
      toast('Department heads saved', 'ok')
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

  return (
    <section className="rounded-card bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-bold">Department heads — new request alerts</h2>
          <p className="text-[13px] text-slate-500">When a new request comes in, the heads of its service get a WhatsApp with the patient, service, address, preferred time and a link to assign it.</p>
        </div>
        <Toggle on={enabled} onChange={setEnabled} label="Send new request alerts" />
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
        {SECTIONS.map((sec) => {
          const rows = list.filter((c) => c.category === sec.key)
          const svc = services[sec.key.toLowerCase()] ?? []
          return (
            <div key={sec.key} className="rounded-xl border border-slate-200 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[14px] font-bold">{sec.title}</div>
                <span className="text-[12px] text-slate-500">
                  {rows.filter((r) => r.active).length} active
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {svc.length ? svc.map((n) => <span key={n} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{n}</span>) : <span className="text-[11.5px] text-slate-400">No active services in this category</span>}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {rows.map((c) => {
                  const bad = showErrors ? problem(c) : null
                  return (
                    <div key={c.id} className={cx('grid gap-2 rounded-lg bg-slate-50 p-2.5 sm:grid-cols-[1fr_1fr_150px_auto]', !c.active && 'opacity-60')}>
                      <input className={cx('hc-input h-9', bad === 'name' && 'border-[#DC2626]')} placeholder="Name" value={c.name} onChange={(e) => upd(c.id, { name: e.target.value })} aria-label="Name" />
                      <input className={cx('hc-input h-9', bad === 'designation' && 'border-[#DC2626]')} placeholder="Designation (e.g. Nursing In-charge)" value={c.designation} onChange={(e) => upd(c.id, { designation: e.target.value })} aria-label="Designation" />
                      <input className={cx('hc-input h-9', bad === 'phone' && 'border-[#DC2626]')} placeholder="WhatsApp 01XXXXXXXXX" inputMode="tel" value={c.phone} onChange={(e) => upd(c.id, { phone: e.target.value })} aria-label="WhatsApp number" />
                      <div className="flex items-center gap-1.5">
                        <Toggle on={c.active} onChange={(v) => upd(c.id, { active: v })} label={`${c.name || 'Contact'} active`} />
                        <button type="button" title="Send a test WhatsApp" disabled={!wa.paired || testing === c.id || digits(c.phone).length < 10} onClick={() => test(c)} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-primary-700 disabled:opacity-40">
                          {testing === c.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                        </button>
                        <button type="button" title="Remove" onClick={() => setList((l) => l.filter((x) => x.id !== c.id))} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-[#B91C1C]">
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setList((l) => [...l, { id: newId(), category: sec.key, name: '', designation: '', phone: '', active: true }])}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-slate-300 text-[13px] font-semibold text-primary-700 hover:bg-primary-50"
                >
                  <Plus size={15} /> Add person
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <button type="button" onClick={save} disabled={busy || !dirty} className={btnClass('p', 'md', 'mt-4')}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save department heads
      </button>
    </section>
  )
}
