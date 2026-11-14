'use client'
// Receive several items at once — from the H360 central store (indent / issue) or a supplier — with a reference no.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, PackagePlus } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { ItemPicker, type Line, type PickItem } from './ItemPicker'

export function ReceiveDrawer({ items, preset = [], onClose }: { items: PickItem[]; preset?: string[]; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [lines, setLines] = useState<Line[]>(preset.map((itemId) => ({ itemId, qty: 1 })))
  const [from, setFrom] = useState('Central store (H360 indent)')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!lines.length) return toast('Add at least one item', 'err')
    setBusy(true)
    try {
      const r = await api<{ count: number }>('/store/receive', { body: { items: lines, from: from.trim() || undefined, ref: ref.trim() || undefined, note: note.trim() || undefined } })
      toast(`${r.count} item${r.count === 1 ? '' : 's'} received into the store`, 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Drawer
      open
      onClose={onClose}
      title="Receive into the store"
      sub="New stock from the H360 central store (indent) or a supplier"
      width={540}
      footer={
        <>
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !lines.length} className={btnClass('p')} onClick={save}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />} Receive {lines.reduce((a, l) => a + l.qty, 0) || ''}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2.5">
          <label>
            <span className="hc-label">From</span>
            <input className="hc-input" list="receive-from" value={from} onChange={(e) => setFrom(e.target.value)} />
            <datalist id="receive-from">
              <option value="Central store (H360 indent)" />
              <option value="Pharmacy" />
              <option value="Supplier" />
            </datalist>
          </label>
          <label>
            <span className="hc-label">Reference no</span>
            <input className="hc-input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Indent / issue / invoice no" />
          </label>
        </div>
        <ItemPicker items={items} lines={lines} setLines={setLines} mode="in" autoFocus />
        <label>
          <span className="hc-label">Note</span>
          <input className="hc-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
      </div>
    </Drawer>
  )
}
