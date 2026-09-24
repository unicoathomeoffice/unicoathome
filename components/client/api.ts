'use client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useToast } from './toast'

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public fields?: Record<string, string>,
  ) {
    super(message)
  }
}

/** fetch wrapper for /api/v1. Throws ApiClientError with the server's message. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(path.startsWith('/api') ? path : `/api/v1${path}`, {
    method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
    headers: opts.form ? undefined : { 'content-type': 'application/json' },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  })
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.location.href = window.location.pathname.startsWith('/m') ? '/m/login' : '/login'
    }
    throw new ApiClientError(data?.error?.message ?? `Request failed (${res.status})`, res.status, data?.error?.code, data?.error?.fields)
  }
  return data as T
}

/**
 * Run a mutation, toast the result and refresh server components.
 *   const { run, busy } = useAction()
 *   run(() => api(`/requests/${id}/accept`, { body: {} }), 'Visit accepted')
 */
export function useAction() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [, start] = useTransition()
  const [error, setError] = useState<ApiClientError | null>(null)
  async function run<T>(fn: () => Promise<T>, success?: string | ((r: T) => string), opts: { refresh?: boolean; redirect?: string } = {}): Promise<T | undefined> {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      if (success) toast(typeof success === 'function' ? success(r) : success, 'ok')
      if (opts.redirect) router.push(opts.redirect)
      if (opts.refresh !== false) start(() => router.refresh())
      return r
    } catch (e: any) {
      setError(e)
      toast(e?.message ?? 'Something went wrong', 'err')
      return undefined
    } finally {
      setBusy(false)
    }
  }
  return { run, busy, error, toast, router }
}

/** Device time stamp for offline-aware actions */
export const stamp = () => ({ deviceAt: new Date().toISOString(), offline: typeof navigator !== 'undefined' ? !navigator.onLine : false })
