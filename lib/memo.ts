import 'server-only'

// Tiny per-instance TTL memo for data that is public and changes slowly (service list, zones, booking grid).
// Lives in module scope, so it survives across requests on a warm server instance and disappears on cold start.
// Use only where showing data up to `ttlMs` old is acceptable; never for anything tied to a user or session.
const store = new Map<string, { at: number; value: Promise<unknown> }>()

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>
  // `.then(load)` turns a Mongoose Query (a thenable that re-executes on every await) into a real Promise that
  // settles once, so the cached value is the result — not a query that would run again for every reader.
  const value = Promise.resolve().then(load)
  store.set(key, { at: Date.now(), value })
  value.catch(() => store.delete(key)) // a failed load is not cached
  return value
}
