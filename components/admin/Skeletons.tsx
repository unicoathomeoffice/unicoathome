// Loading screens shaped like the real pages, so a click shows the page's frame at once and the content fills in
// without a jump. They contain no data. Used by the loading.tsx files under app/(admin).

const Bar = ({ className = '' }: { className?: string }) => <div className={`hc-skeleton rounded ${className}`} />

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading page…</span>
      {/* same height as the real top bar (components/admin/AdminPage.tsx) */}
      <header className="flex h-16 flex-none items-center gap-4 border-b border-slate-200 bg-white pl-16 pr-4 lg:px-8">
        <div className="flex-1 space-y-1.5">
          <Bar className="h-2.5 w-40" />
          <Bar className="h-5 w-32" />
        </div>
        <Bar className="hidden h-10 w-[360px] rounded-lg xl:block" />
        <Bar className="size-10 rounded-lg" />
        <Bar className="size-10 rounded-full" />
      </header>
      <main aria-hidden className="min-h-0 flex-1 overflow-hidden px-4 py-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <Frame>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <Bar key={i} className="h-[92px] rounded-card" />
        ))}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Bar className="h-[340px] rounded-card" />
        <Bar className="h-[340px] rounded-card" />
      </div>
    </Frame>
  )
}

export function TableSkeleton() {
  return (
    <Frame>
      <div className="mb-4 flex flex-wrap gap-2.5">
        <Bar className="h-10 w-[230px] rounded-lg" />
        {Array.from({ length: 4 }, (_, i) => (
          <Bar key={i} className="h-10 w-[120px] rounded-lg" />
        ))}
      </div>
      <div className="overflow-hidden rounded-card bg-white shadow-card">
        <Bar className="h-11 rounded-none opacity-70" />
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-t border-slate-100 px-4 py-3.5">
            <Bar className="size-9 rounded-full" />
            <Bar className="h-3.5 w-48" />
            <Bar className="h-3.5 w-32" />
            <Bar className="ml-auto h-6 w-24 rounded-full" />
          </div>
        ))}
      </div>
    </Frame>
  )
}

export function StoreSkeleton() {
  return (
    <Frame>
      <Bar className="mb-4 h-10 w-[420px] max-w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Bar key={i} className="h-[70px] rounded-2xl" />
        ))}
      </div>
      <Bar className="mt-5 h-[108px] rounded-2xl" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/80">
            <Bar className="aspect-square rounded-none" />
            <div className="space-y-2 p-3">
              <Bar className="h-3.5 w-4/5" />
              <Bar className="h-3 w-1/2" />
              <Bar className="h-1.5 w-full rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </Frame>
  )
}

export function ChatSkeleton() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading page…</span>
      <header className="flex h-16 flex-none items-center border-b border-slate-200 bg-white pl-16 pr-4 lg:px-8">
        <div className="space-y-1.5">
          <Bar className="h-2.5 w-48" />
          <Bar className="h-5 w-28" />
        </div>
      </header>
      <div aria-hidden className="flex min-h-0 flex-1">
        <div className="w-full border-r border-slate-200 bg-white md:w-[360px] xl:w-[400px]">
          <Bar className="h-[60px] rounded-none opacity-60" />
          <div className="p-3">
            <Bar className="h-9 rounded-lg" />
          </div>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <Bar className="size-[46px] flex-none rounded-full" />
              <div className="flex-1 space-y-2">
                <Bar className="h-3.5 w-2/3" />
                <Bar className="h-3 w-5/6" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden flex-1 bg-[#EFEAE2] md:block" />
      </div>
    </div>
  )
}
