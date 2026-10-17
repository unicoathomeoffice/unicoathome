/** Shared streaming fallback; contains no patient or account data. Shown the instant a navigation starts. */
export function PageLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="hc-enter w-full flex-1 space-y-5 p-5 md:p-8">
      <span className="sr-only">Loading page…</span>
      <div aria-hidden="true" className="space-y-5">
        <div className="hc-skeleton h-7 w-40 rounded" />
        <div className="grid grid-cols-2 gap-3">
          <div className="hc-skeleton h-24 rounded-xl" />
          <div className="hc-skeleton h-24 rounded-xl" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="hc-skeleton h-24 rounded-xl" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
    </div>
  )
}
