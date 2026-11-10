import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

// Which click a WhatsApp message came from. route() (lib/api.ts) runs each API call inside this context when the browser
// sends an `x-wa-batch` id; Next's after() keeps the context, so background sends of that action carry the same batch.
// The review window (components/client/WaReview.tsx) then shows exactly that action's messages for approval.

type WaCtx = { batch: string; userId: string }
const store = new AsyncLocalStorage<WaCtx>()

export const BATCH_RX = /^[a-z0-9-]{8,40}$/

export function withWaBatch<T>(batch: string | null | undefined, userId: string, fn: () => T): T {
  return batch && BATCH_RX.test(batch) ? store.run({ batch, userId }, fn) : fn()
}

export const waBatch = () => store.getStore() ?? null
