'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Mic, MicOff, MoreVertical, PenLine, Search, Trash2, X } from 'lucide-react'
import { api, useAction, Sheet, Segmented } from '@/components/client'
import { cx } from '@/lib/format'
import { bbtn } from './ui'

type Link = { kind: 'patient' | 'visit'; id: string; label: string; sub?: string } | null
type Draft = { id?: string; type: string; text: string; tags: string[]; visibility: string; link: Link }

const TYPES = [
  { value: 'PATIENT', label: 'Patient' },
  { value: 'CLINICAL', label: 'Visit' },
  { value: 'HANDOVER', label: 'Handover' },
  { value: 'GENERAL', label: 'Personal' },
]
const QUICK_TAGS = ['Doctor review needed', 'Family informed', 'Supplies low', 'Follow-up visit', 'Red flag']

const initialsOf = (n?: string) =>
  (n ?? '?')
    .replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join('')
    .toUpperCase()

/** M22 — add / edit note sheet: type, link to patient or visit, dictation, quick tags, visibility. */
function NoteSheet({ open, onClose, draft, me, canSearchPatients, allVisits }: { open: boolean; onClose: () => void; draft: Draft; me: { name: string; initials: string }; canSearchPatients: boolean; allVisits?: boolean }) {
  const [type, setType] = useState(draft.type)
  const [text, setText] = useState(draft.text)
  const [tags, setTags] = useState<string[]>(draft.tags)
  const [vis, setVis] = useState(draft.visibility)
  const [link, setLink] = useState<Link>(draft.link)
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const [options, setOptions] = useState<NonNullable<Link>[]>([])
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const rec = useRef<any>(null)
  const { run, busy } = useAction()
  const editing = !!draft.id

  useEffect(() => {
    if (!open) return
    setType(draft.type)
    setText(draft.text)
    setTags(draft.tags)
    setVis(draft.visibility)
    setLink(draft.link)
    setPicking(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const wantKind: 'patient' | 'visit' = type === 'CLINICAL' ? 'visit' : 'patient'
  useEffect(() => {
    if (!picking) return
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        if (wantKind === 'patient') {
          if (!canSearchPatients || q.trim().length < 2) return setOptions([])
          const r = await api<{ items: any[] }>(`/patients?q=${encodeURIComponent(q.trim())}&limit=8`)
          setOptions(r.items.map((p) => ({ kind: 'patient', id: p._id, label: p.name, sub: [p.ageYears != null ? `${p.ageYears} ${p.gender ?? ''}`.trim() : '', p.uhid ? `UHID ${p.uhid}` : p.phone, p.address?.area].filter(Boolean).join(' · ') })))
        } else {
          const r = await api<{ items: any[] }>(`/requests?mine=${allVisits ? 0 : 1}&limit=30&sort=created${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
          setOptions(r.items.map((x) => ({ kind: 'visit', id: x._id, label: `${x.requestNo} · ${x.patientSnapshot?.name ?? ''}`, sub: (x.services ?? []).map((s: any) => s.name).join(', ') })))
        }
      } catch {
        setOptions([])
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [q, picking, wantKind, canSearchPatients, allVisits])

  function dictate() {
    const SR = typeof window !== 'undefined' ? (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition : null
    if (!SR) return alert('Dictation is not available in this browser. Use the keyboard microphone instead.')
    if (listening) {
      rec.current?.stop()
      return
    }
    const r = new SR()
    r.lang = 'en-US'
    r.continuous = true
    r.interimResults = false
    r.onresult = (e: any) => {
      let add = ''
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) add += e.results[i][0].transcript
      if (add) setText((t) => (t ? `${t.trimEnd()} ${add.trim()}` : add.trim()))
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    rec.current = r
    r.start()
    setListening(true)
  }

  async function save() {
    rec.current?.stop()
    const body: any = { type, text: text.trim(), tags, visibility: vis }
    if (!editing) {
      if (link?.kind === 'patient') body.patientId = link.id
      if (link?.kind === 'visit') body.requestId = link.id
    }
    const r = await run(() => (editing ? api(`/notes/${draft.id}`, { method: 'PATCH', body }) : api('/notes', { body })), editing ? 'Note updated' : 'Note saved')
    if (r) onClose()
  }

  const linkNeeded = type === 'PATIENT' && !link
  return (
    <Sheet
      open={open}
      onClose={onClose}
      footer={
        <>
          <button className={bbtn('o', 'flex-1')} onClick={onClose}>
            Cancel
          </button>
          <button className={bbtn('p', 'flex-[1.4]')} disabled={busy || !text.trim() || (linkNeeded && !editing)} onClick={save}>
            {busy && <Loader2 size={18} className="animate-spin" />}
            {editing ? 'Save changes' : 'Save note'}
          </button>
        </>
      }
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[19px] font-bold">{editing ? 'Edit note' : 'New note'}</div>
        <div className="flex items-center gap-2 text-[13px] text-slate-500">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary-50 text-[10px] font-bold text-primary-700">{me.initials}</span>
          {me.name}
        </div>
      </div>
      <Segmented
        h={36}
        value={type}
        onChange={(v) => {
          setType(v)
          if (v === 'GENERAL' && !editing) setVis('PRIVATE')
          if (link && ((v === 'CLINICAL' && link.kind !== 'visit') || (v === 'PATIENT' && link.kind !== 'patient'))) setLink(null)
        }}
        items={TYPES}
      />
      {!editing && type !== 'GENERAL' && (
        <div className="mt-3">
          {picking ? (
            <div className="rounded-xl border-[1.5px] border-primary bg-white">
              <label className="flex h-11 items-center gap-2 px-3">
                <Search size={18} className="text-slate-400" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={wantKind === 'patient' ? 'Search patient by phone, UHID or name' : 'Search your visits'} className="min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
                {loading ? <Loader2 size={16} className="animate-spin text-slate-400" /> : <X size={16} className="text-slate-400" onClick={() => setPicking(false)} />}
              </label>
              <div className="max-h-[200px] divide-y divide-slate-100 overflow-y-auto border-t border-slate-100">
                {options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setLink(o)
                      setPicking(false)
                      setQ('')
                    }}
                    className="flex w-full flex-col items-start px-3 py-2.5 text-left"
                  >
                    <span className="text-[14px] font-semibold">{o.label}</span>
                    {o.sub && <span className="text-[12px] text-slate-500">{o.sub}</span>}
                  </button>
                ))}
                {!loading && !options.length && <div className="px-3 py-3 text-[13px] text-slate-500">{wantKind === 'patient' ? (canSearchPatients ? 'Type 2+ characters' : 'Patient search is not available for your role') : 'No visits found'}</div>}
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setPicking(true)} className="flex h-[52px] w-full items-center gap-3 rounded-xl border-[1.5px] border-slate-300 bg-white px-3 text-left">
              {link ? (
                <>
                  <span className="flex size-8 flex-none items-center justify-center rounded-full bg-primary-50 text-[11px] font-bold text-primary-700">{initialsOf(link.label.split(' · ').pop())}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px]">
                    <b>{link.label}</b> {link.sub && <span className="text-slate-500">· {link.sub}</span>}
                  </span>
                </>
              ) : (
                <span className="flex-1 text-[15px] text-slate-400">{type === 'CLINICAL' ? 'Link to a visit' : type === 'PATIENT' ? 'Which patient? (required)' : 'Link to a patient (optional)'}</span>
              )}
              <ChevronDown size={18} className="text-slate-400" />
            </button>
          )}
        </div>
      )}
      <div className="relative mt-3">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write the note…" className="h-[140px] w-full resize-none rounded-xl border-[1.5px] border-slate-300 bg-white px-3.5 py-3 pb-12 text-[15px] leading-6 outline-none focus:border-primary" />
        <button type="button" onClick={dictate} className={cx('absolute bottom-3 right-3 flex size-9 items-center justify-center rounded-[10px]', listening ? 'bg-[#DC2626] text-white' : 'bg-slate-100 text-slate-700')} aria-label="Dictate">
          {listening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        {listening && <span className="absolute bottom-5 left-3.5 text-[12px] font-semibold text-[#DC2626]">Listening…</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {QUICK_TAGS.map((t) => {
          const on = tags.includes(t)
          return (
            <button key={t} type="button" onClick={() => setTags(on ? tags.filter((x) => x !== t) : [...tags, t])} className={cx('inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-semibold', on ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}>
              {on && <Check size={14} strokeWidth={3} />}
              {t}
            </button>
          )
        })}
      </div>
      <div className="mb-1.5 mt-3 text-[13px] font-semibold text-slate-700">Who can see this</div>
      <Segmented
        h={36}
        value={vis}
        onChange={setVis}
        items={[
          { value: 'TEAM', label: 'Team' },
          { value: 'COORDINATOR', label: 'Coordinator only' },
          { value: 'PRIVATE', label: 'Only me' },
        ]}
      />
    </Sheet>
  )
}

/** Floating "Add note" button + sheet (M21 FAB). */
export function AddNoteFab({ me, link, defaultType, canSearchPatients, allVisits, aboveTabs = true }: { me: { name: string; initials: string }; link?: Link; defaultType?: string; canSearchPatients: boolean; allVisits?: boolean; aboveTabs?: boolean }) {
  const [open, setOpen] = useState(false)
  const draft: Draft = { type: defaultType ?? (link?.kind === 'visit' ? 'CLINICAL' : link?.kind === 'patient' ? 'PATIENT' : 'HANDOVER'), text: '', tags: [], visibility: 'TEAM', link: link ?? null }
  return (
    <>
      <div className={cx('pointer-events-none fixed inset-x-0 z-30 mx-auto flex w-full max-w-[480px] justify-end px-5', aboveTabs ? 'bottom-[92px]' : 'bottom-6')}>
        <button type="button" onClick={() => setOpen(true)} className="pointer-events-auto flex h-[52px] items-center gap-2 rounded-full bg-primary px-5 text-[16px] font-bold text-white shadow-[0_6px_16px_rgba(0,144,202,.35)]">
          <PenLine size={20} /> Add note
        </button>
      </div>
      <NoteSheet open={open} onClose={() => setOpen(false)} draft={draft} me={me} canSearchPatients={canSearchPatients} allVisits={allVisits} />
    </>
  )
}

/** ⋮ menu on your own note: edit / delete. */
export function NoteMenu({ note, me }: { note: { id: string; type: string; text: string; tags: string[]; visibility: string }; me: { name: string; initials: string } }) {
  const [menu, setMenu] = useState(false)
  const [edit, setEdit] = useState(false)
  const { run } = useAction()
  return (
    <>
      <button type="button" onClick={() => setMenu(true)} className="-mr-1.5 flex size-8 items-center justify-center rounded-md text-slate-400" aria-label="Note actions">
        <MoreVertical size={18} />
      </button>
      <Sheet open={menu} onClose={() => setMenu(false)} title="Your note">
        <div className="grid gap-2 pb-2">
          <button
            type="button"
            className="flex h-12 items-center gap-3 rounded-xl bg-slate-100 px-4 text-[15px] font-semibold"
            onClick={() => {
              setMenu(false)
              setEdit(true)
            }}
          >
            <PenLine size={18} /> Edit note
          </button>
          <button
            type="button"
            className="flex h-12 items-center gap-3 rounded-xl bg-[#FEF2F2] px-4 text-[15px] font-semibold text-[#B91C1C]"
            onClick={async () => {
              if (!window.confirm('Delete this note?')) return
              const r = await run(() => api(`/notes/${note.id}`, { method: 'DELETE' }), 'Note deleted')
              if (r) setMenu(false)
            }}
          >
            <Trash2 size={18} /> Delete note
          </button>
        </div>
      </Sheet>
      <NoteSheet open={edit} onClose={() => setEdit(false)} draft={{ ...note, link: null }} me={me} canSearchPatients={false} />
    </>
  )
}
