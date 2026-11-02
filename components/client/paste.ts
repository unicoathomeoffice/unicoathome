'use client'
// Paste (Ctrl+V) and drag & drop for upload boxes: a copied image, a screenshot snip or a PDF lands like a picked file.
import { useEffect, useState, type DragEvent } from 'react'

const ok = (f: File, accept: string[]) => accept.some((a) => (a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : f.type === a))
const stampName = (f: File) => {
  if (f.name && f.name !== 'image.png' && f.name !== 'blob') return f
  const ext = f.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return new File([f], `pasted-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`, { type: f.type })
}

/** Files on the clipboard / in a drop that match `accept` (e.g. ['image/*', 'application/pdf']). */
export function filesFrom(list: DataTransfer | null | undefined, accept: string[]) {
  if (!list) return []
  const out: File[] = []
  for (const it of Array.from(list.items ?? [])) {
    if (it.kind !== 'file') continue
    const f = it.getAsFile()
    if (f && ok(f, accept)) out.push(stampName(f))
  }
  if (!out.length) for (const f of Array.from(list.files ?? [])) if (ok(f, accept)) out.push(stampName(f))
  return out
}

/**
 * While `enabled`, a Ctrl+V anywhere on the page hands pasted files to `onFiles` (text pastes into inputs are left alone).
 * Returns drag & drop props for the drop box and whether something is being dragged over it.
 */
export function usePasteFiles(onFiles: (files: File[]) => void, opts: { enabled?: boolean; accept?: string[] } = {}) {
  const { enabled = true, accept = ['image/*', 'application/pdf'] } = opts
  const [over, setOver] = useState(false)
  useEffect(() => {
    if (!enabled) return
    const h = (e: ClipboardEvent) => {
      const files = filesFrom(e.clipboardData, accept)
      if (!files.length) return
      // typing / pasting text into a field: only take over when the clipboard holds a file and no text
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName) && e.clipboardData?.getData('text/plain')) return
      e.preventDefault()
      onFiles(files)
    }
    document.addEventListener('paste', h)
    return () => document.removeEventListener('paste', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, onFiles, accept.join(',')])
  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!enabled) return
      e.preventDefault()
      setOver(true)
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      if (!enabled) return
      e.preventDefault()
      setOver(false)
      const files = filesFrom(e.dataTransfer, accept)
      if (files.length) onFiles(files)
    },
  }
  return { over, dropProps }
}

/** "Paste image" button: read the clipboard directly (needs the browser's clipboard permission). */
export async function readClipboardFiles(accept: string[] = ['image/*', 'application/pdf']): Promise<File[] | 'denied'> {
  try {
    const items = await navigator.clipboard.read()
    const out: File[] = []
    for (const it of items) {
      const type = it.types.find((t) => accept.some((a) => (a.endsWith('/*') ? t.startsWith(a.slice(0, -1)) : t === a)))
      if (type) out.push(stampName(new File([await it.getType(type)], 'image.png', { type })))
    }
    return out
  } catch {
    return 'denied'
  }
}
