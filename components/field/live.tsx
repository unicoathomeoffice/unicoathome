'use client'
// Offline awareness for the field app: an outbox in localStorage for stamped visit actions
// (ticks, vitals, notes, journey, check-in) and the SyncBanner that shows / flushes it.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CloudOff, RefreshCw } from 'lucide-react'
import { api } from '@/components/client'
import { ApiClientError } from '@/components/client/api'
import { useToast } from '@/components/client/toast'

const KEY = 'hc_outbox'
type Item = { id: string; path: string; method: string; body: unknown; label: string; at: string }

function read(): Item[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}
function write(items: Item[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {}
  window.dispatchEvent(new Event('hc-outbox'))
}

/**
 * Send a visit action now, or keep it in the outbox when the phone is offline / the network fails.
 * Server-side validation errors are thrown (they will not succeed on retry).
 */
export async function sendOrQueue<T = any>(path: string, body: unknown, opts: { method?: string; label: string }): Promise<{ queued: boolean; data?: T }> {
  const method = opts.method ?? 'POST'
  const enqueue = () => {
    write([...read(), { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, path, method, body, label: opts.label, at: new Date().toISOString() }])
    return { queued: true }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return enqueue()
  try {
    return { queued: false, data: await api<T>(path, { method, body }) }
  } catch (e) {
    if (e instanceof ApiClientError) throw e
    return enqueue()
  }
}

let flushing = false
/** Replay queued actions in order. Returns the number of actions sent. */
export async function flushOutbox(onRejected?: (label: string, msg: string) => void) {
  if (flushing || !navigator.onLine) return 0
  flushing = true
  let sent = 0
  try {
    for (const item of read()) {
      try {
        await api(item.path, { method: item.method, body: item.body })
        sent++
        write(read().filter((x) => x.id !== item.id))
      } catch (e) {
        if (e instanceof ApiClientError) {
          // the server refused it (e.g. already done) — drop it and tell the user
          write(read().filter((x) => x.id !== item.id))
          onRejected?.(item.label, e.message)
        } else break // still offline
      }
    }
  } finally {
    flushing = false
  }
  return sent
}

export function useOutbox() {
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  useEffect(() => {
    const sync = () => {
      setOnline(navigator.onLine)
      setPending(read().length)
    }
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    window.addEventListener('hc-outbox', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
      window.removeEventListener('hc-outbox', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return { online, pending }
}

/** Dark strip under the status bar: "Offline · actions will retry" / "Syncing 3 actions…" (M05-b). */
export function SyncBanner() {
  const { online, pending } = useOutbox()
  const router = useRouter()
  const toast = useToast()
  useEffect(() => {
    if (!online || !pending) return
    let alive = true
    const go = async () => {
      const n = await flushOutbox((label, msg) => toast(`${label}: ${msg}`, 'err'))
      if (alive && n) {
        toast(`${n} offline action${n === 1 ? '' : 's'} synced`, 'ok')
        router.refresh()
      }
    }
    go()
    const t = setInterval(go, 15_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [online, pending, router, toast])
  if (online && !pending) return null
  return (
    <div className="flex h-8 items-center justify-center gap-2 bg-slate-900 text-[12px] font-semibold text-white">
      {online ? <RefreshCw size={13} className="animate-spin" /> : <CloudOff size={14} />}
      {online ? `Syncing ${pending} action${pending === 1 ? '' : 's'}…` : `Offline · ${pending ? `${pending} action${pending === 1 ? '' : 's'} pending · ` : ''}actions will retry`}
    </div>
  )
}
