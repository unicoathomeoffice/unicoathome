/** Shared streaming fallback; contains no patient or account data. */
export function PageLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="w-full flex-1 space-y-5 p-5 md:p-8">
      <span className="sr-only">Loading page…</span>
      <div aria-hidden="true" className="space-y-5 motion-safe:animate-pulse">
        <div className="h-7 w-40 rounded bg-slate-200" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-24 rounded-xl bg-white shadow-sm" />
          <div className="h-24 rounded-xl bg-white shadow-sm" />
        </div>
        {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-white shadow-sm" />)}
      </div>
    </div>
  )
}
