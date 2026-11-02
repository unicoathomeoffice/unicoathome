'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Check, ChevronLeft, ChevronRight, Crop, ImagePlus, Loader2, Maximize, RotateCw, ScanLine, Sparkles, Trash2, X } from 'lucide-react'
import { cx } from '@/lib/format'
import { CropView } from './CropView'
import { detectCv, detectLite, loadOpenCV, type Detection } from './detect'
import { applyFilter, FILTERS, type FilterId } from './filters'
import { fullQuad, loadSource, rotateCw, warp, type Quad } from './geometry'
import { jpegFile, pdfFile } from './output'

type How = 'cv' | 'lite' | 'none' | 'manual'
type Page = {
  id: number
  src: HTMLCanvasElement
  quad: Quad
  how: How
  reviewed: boolean
  flat?: HTMLCanvasElement
  look: Partial<Record<FilterId, HTMLCanvasElement>>
}

export type ScanOptions = {
  /** several photos / "Add page" → one PDF (default true) */
  multiPage?: boolean
  filters?: FilterId[]
  defaultFilter?: FilterId
  title?: string
  maxPages?: number
}

const CV_PREF = 'hc.scan.enhanced'
let seq = 1

const readPref = () => {
  try {
    return localStorage.getItem(CV_PREF) !== 'off'
  } catch {
    return true
  }
}

/**
 * CamScanner-style editor: auto-detected page edges (built-in detector at once, OpenCV when it has loaded),
 * drag the corners to fix them, perspective-flatten, pick a filter, save as a JPEG (one page) or one PDF.
 */
export function DocScanner({
  files,
  multiPage = true,
  filters = FILTERS.map((f) => f.id),
  defaultFilter = 'magic',
  title = 'Scan document',
  maxPages = 10,
  onDone,
  onCancel,
}: ScanOptions & { files: File[]; onDone: (files: File[]) => void; onCancel: () => void }) {
  const [pages, setPages] = useState<Page[]>([])
  const [idx, setIdx] = useState(0)
  const [step, setStep] = useState<'load' | 'crop' | 'enhance'>('load')
  const [filter, setFilter] = useState<FilterId>(filters.includes(defaultFilter) ? defaultFilter : filters[0])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [enhanced, setEnhanced] = useState(readPref)
  const [cvState, setCvState] = useState<'off' | 'loading' | 'ready' | 'failed'>('off')
  const cv = useRef<any>(null)
  const failed = useRef<File[]>([])
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)
  const [mounted, setMounted] = useState(false)

  const detect = useCallback((src: HTMLCanvasElement): Detection & { how: How } => {
    if (cv.current) {
      const d = detectCv(cv.current, src)
      if (d.ok) return { ...d, how: 'cv' }
    }
    const d = detectLite(src)
    return { ...d, how: d.ok ? 'lite' : 'none' }
  }, [])

  const addFiles = useCallback(
    async (list: File[]) => {
      setBusy('Reading photo…')
      const added: Page[] = []
      for (const f of list) {
        try {
          const src = await loadSource(f)
          const d = detect(src)
          added.push({ id: seq++, src, quad: d.quad, how: d.how, reviewed: false, look: {} })
        } catch {
          failed.current.push(f)
        }
      }
      setBusy(null)
      return added
    },
    [detect],
  )

  // first load
  useEffect(() => {
    setMounted(true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    let live = true
    addFiles(files.slice(0, multiPage ? maxPages : 1)).then((added) => {
      if (!live) return
      if (!added.length) {
        // the browser could not open these photos (e.g. HEIC on Chrome): hand them back untouched
        onDone(failed.current)
        return
      }
      setPages(added)
      setStep('crop')
    })
    return () => {
      live = false
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // OpenCV in the background; when ready, re-detect every page the user has not adjusted by hand
  useEffect(() => {
    if (!enhanced) {
      setCvState('off')
      return
    }
    if (cv.current) return setCvState('ready')
    let live = true
    setCvState('loading')
    loadOpenCV().then((r) => {
      if (!live) return
      if (!r) return setCvState('failed')
      cv.current = r.cv
      setCvState('ready')
      setPages((ps) =>
        ps.map((p) => {
          if (p.how === 'manual' || p.reviewed) return p // never move corners the user has already seen
          const d = detectCv(r.cv, p.src)
          return d.ok ? { ...p, quad: d.quad, how: 'cv', flat: undefined, look: {} } : p
        }),
      )
    })
    return () => {
      live = false
    }
  }, [enhanced])

  useEffect(() => {
    // capture phase + stop: Esc closes only the scanner, not the drawer it was opened from
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const page = pages[idx]
  const update = (id: number, patch: Partial<Page>) => setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  function toggleEnhanced() {
    const v = !enhanced
    setEnhanced(v)
    try {
      localStorage.setItem(CV_PREF, v ? 'on' : 'off')
    } catch {}
  }

  /** Flatten (and filter) every page that needs it, then show the enhance step. */
  async function finishCrop() {
    const next = pages.findIndex((p, i) => i > idx && !p.reviewed)
    const marked = pages.map((p, i) => (i === idx ? { ...p, reviewed: true } : p))
    if (next >= 0) {
      setPages(marked)
      setIdx(next)
      return
    }
    setBusy('Straightening…')
    await new Promise((r) => setTimeout(r, 30)) // let the spinner paint
    const done = marked.map((p) => (p.flat ? p : { ...p, flat: warp(p.src, p.quad), look: {} }))
    setPages(done)
    setBusy(null)
    setStep('enhance')
  }

  function lookOf(p: Page, f: FilterId) {
    if (!p.flat) return null
    if (!p.look[f]) p.look[f] = applyFilter(p.flat, f) // cached on the page object
    return p.look[f]!
  }

  async function save() {
    setBusy(pages.length > 1 ? 'Making the PDF…' : 'Saving…')
    await new Promise((r) => setTimeout(r, 30))
    try {
      const outs = pages.map((p) => lookOf(p, filter)!).filter(Boolean)
      const file = outs.length > 1 ? await pdfFile(outs) : await jpegFile(outs[0])
      onDone([file, ...failed.current])
    } catch (e: any) {
      setBusy(null)
      setNote(e?.message ?? 'Could not save the scan')
    }
  }

  async function onPick(list: FileList | null) {
    const room = maxPages - pages.length
    const arr = Array.from(list ?? []).filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, room))
    if (!arr.length) return
    const added = await addFiles(arr)
    if (!added.length) return setNote('That photo could not be opened — try a JPG or PNG.')
    setPages((ps) => [...ps, ...added])
    setIdx(pages.length)
    setStep('crop')
  }

  function removePage(i: number) {
    if (pages.length === 1) return onCancel()
    setPages((ps) => ps.filter((_, j) => j !== i))
    setIdx((x) => Math.max(0, Math.min(x, pages.length - 2)))
  }

  function rotate(p: Page) {
    const r = rotateCw(p.src, p.quad)
    const flat = p.flat ? rotateCw(p.flat, fullQuad(p.flat.width, p.flat.height)).src : undefined
    update(p.id, { src: r.src, quad: r.quad, flat, look: {} })
  }

  if (!mounted) return null
  const howLabel: Record<How, string> = {
    cv: 'Page edges found (enhanced)',
    lite: 'Page edges found',
    none: 'No clear edges — drag the corners to the page',
    manual: 'Adjusted by hand',
  }
  const lastUnreviewed = pages.findIndex((p, i) => i > idx && !p.reviewed) < 0

  return createPortal(
    <div className="fixed inset-0 z-[300] flex flex-col bg-slate-900 text-white" role="dialog" aria-modal="true" aria-label={title}>
      {/* header */}
      <div className="flex h-14 flex-none items-center gap-2 border-b border-white/10 px-2 sm:px-4">
        <button type="button" onClick={onCancel} className="flex size-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="Close scanner">
          <X size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold">{title}</div>
          <div className="truncate text-[12px] text-slate-400">
            {step === 'crop' ? `Crop · page ${idx + 1} of ${pages.length}` : step === 'enhance' ? `Enhance · ${pages.length} page${pages.length > 1 ? 's' : ''}` : 'Opening…'}
          </div>
        </div>
        <button
          type="button"
          onClick={toggleEnhanced}
          title="Downloads a better edge detector once (about 10 MB). Turn off on slow mobile data."
          className={cx('flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold ring-1', enhanced ? 'bg-primary/20 text-[#7DD3FC] ring-primary/50' : 'text-slate-400 ring-white/15')}
        >
          {cvState === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          <span className="hidden sm:inline">Enhanced detection</span>
          <span className="sm:hidden">HD</span>
          <span className="opacity-80">{!enhanced ? 'off' : cvState === 'loading' ? '…' : cvState === 'failed' ? 'unavailable' : 'on'}</span>
        </button>
      </div>

      {/* body */}
      <div className="relative min-h-0 flex-1">
        {step === 'crop' && page && (
          <>
            <CropView key={page.id} src={page.src} quad={page.quad} onChange={(q) => update(page.id, { quad: q, how: 'manual', flat: undefined, look: {} })} />
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <span className={cx('rounded-full px-3 py-1.5 text-[12.5px] font-semibold backdrop-blur', page.how === 'none' ? 'bg-[#B45309]/80' : 'bg-slate-900/70')}>
                {howLabel[page.how]}
              </span>
            </div>
          </>
        )}
        {step === 'enhance' && page && <Preview canvas={lookOf(page, filter)} />}
        {step === 'enhance' && pages.length > 1 && (
          <>
            <button type="button" disabled={idx === 0} onClick={() => setIdx(idx - 1)} className="absolute left-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/70 disabled:opacity-30" aria-label="Previous page">
              <ChevronLeft size={22} />
            </button>
            <button type="button" disabled={idx === pages.length - 1} onClick={() => setIdx(idx + 1)} className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/70 disabled:opacity-30" aria-label="Next page">
              <ChevronRight size={22} />
            </button>
          </>
        )}
        {(busy || step === 'load') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/70">
            <Loader2 size={32} className="animate-spin text-primary" />
            <span className="text-[14px] text-slate-200">{busy ?? 'Opening…'}</span>
          </div>
        )}
        {note && (
          <button type="button" onClick={() => setNote(null)} className="absolute inset-x-3 top-3 rounded-lg bg-[#B91C1C] px-3 py-2.5 text-left text-[13.5px] font-semibold">
            {note}
          </button>
        )}
      </div>

      {/* tools + primary action */}
      <div className="flex-none border-t border-white/10 bg-slate-950/60 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        {step === 'crop' && page && (
          <div className="mx-auto flex max-w-[720px] flex-col gap-3">
            <div className="grid grid-cols-4 gap-2">
              <Tool
                icon={<ScanLine size={20} />}
                label="Auto"
                onClick={() => {
                  const d = detect(page.src)
                  update(page.id, { quad: d.quad, how: d.how, flat: undefined, look: {} })
                  if (!d.ok) setNote('No clear page edges found — drag the corners by hand.')
                }}
              />
              <Tool icon={<Maximize size={20} />} label="Full photo" onClick={() => update(page.id, { quad: fullQuad(page.src.width, page.src.height), how: 'manual', flat: undefined, look: {} })} />
              <Tool icon={<RotateCw size={20} />} label="Rotate" onClick={() => rotate(page)} />
              <Tool icon={<Trash2 size={20} />} label={pages.length > 1 ? 'Remove' : 'Discard'} onClick={() => removePage(idx)} />
            </div>
            <button type="button" onClick={finishCrop} disabled={!!busy} className="flex h-[52px] items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-bold hover:bg-primary-700 disabled:opacity-60">
              <Crop size={18} /> {lastUnreviewed ? 'Crop' : 'Next page'}
            </button>
          </div>
        )}
        {step === 'enhance' && page && (
          <div className="mx-auto flex max-w-[720px] flex-col gap-3">
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
              {FILTERS.filter((f) => filters.includes(f.id)).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={cx('h-10 flex-none rounded-full px-4 text-[13.5px] font-semibold ring-1', filter === f.id ? 'bg-white text-slate-900 ring-white' : 'text-slate-200 ring-white/20 hover:bg-white/10')}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
              {pages.map((p, i) => (
                <button key={p.id} type="button" onClick={() => setIdx(i)} className={cx('relative h-[60px] w-[46px] flex-none overflow-hidden rounded-md bg-white ring-2', i === idx ? 'ring-primary' : 'ring-transparent opacity-70')} aria-label={`Page ${i + 1}`}>
                  <Thumb canvas={p.flat} />
                  <span className="absolute bottom-0 right-0 rounded-tl bg-slate-900/80 px-1 text-[10px] font-bold">{i + 1}</span>
                </button>
              ))}
              {multiPage && pages.length < maxPages && (
                <>
                  <button type="button" onClick={() => camRef.current?.click()} className="flex h-[60px] w-[52px] flex-none flex-col items-center justify-center gap-0.5 rounded-md text-[10.5px] font-semibold text-slate-300 border border-dashed border-white/30 hover:bg-white/10">
                    <Camera size={18} /> Page
                  </button>
                  <button type="button" onClick={() => galRef.current?.click()} className="flex h-[60px] w-[52px] flex-none flex-col items-center justify-center gap-0.5 rounded-md text-[10.5px] font-semibold text-slate-300 ring-1 ring-white/30 hover:bg-white/10">
                    <ImagePlus size={18} /> Photo
                  </button>
                </>
              )}
              <div className="ml-auto flex flex-none gap-1">
                <IconTool icon={<Crop size={19} />} label="Re-crop this page" onClick={() => setStep('crop')} />
                <IconTool icon={<RotateCw size={19} />} label="Rotate this page" onClick={() => rotate(page)} />
                <IconTool icon={<Trash2 size={19} />} label="Remove this page" onClick={() => removePage(idx)} />
              </div>
            </div>
            <button type="button" onClick={save} disabled={!!busy} className="flex h-[52px] items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-bold hover:bg-primary-700 disabled:opacity-60">
              <Check size={19} /> {pages.length > 1 ? `Save PDF · ${pages.length} pages` : 'Save scan'}
            </button>
          </div>
        )}
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => (onPick(e.target.files), (e.target.value = ''))} />
      <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => (onPick(e.target.files), (e.target.value = ''))} />
    </div>,
    document.body,
  )
}

function Tool({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-[12px] font-semibold text-slate-200 hover:bg-white/10 active:bg-white/15">
      {icon}
      {label}
    </button>
  )
}

function IconTool({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="flex size-11 items-center justify-center rounded-full text-slate-200 hover:bg-white/10">
      {icon}
    </button>
  )
}

/** Draw a page canvas into an on-screen canvas that fits its box. */
function Preview({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !canvas) return
    const s = Math.min(1, 1600 / Math.max(canvas.width, canvas.height))
    c.width = Math.round(canvas.width * s)
    c.height = Math.round(canvas.height * s)
    const g = c.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(canvas, 0, 0, c.width, c.height)
  }, [canvas])
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <canvas ref={ref} className="max-h-full max-w-full rounded-sm bg-white shadow-2xl" />
    </div>
  )
}

function Thumb({ canvas }: { canvas?: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !canvas) return
    const s = 120 / Math.max(canvas.width, canvas.height)
    c.width = Math.round(canvas.width * s)
    c.height = Math.round(canvas.height * s)
    c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height)
  }, [canvas])
  return <canvas ref={ref} className="size-full object-contain" />
}
