'use client'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

type Toast = { id: number; kind: 'ok' | 'err' | 'info'; text: string }
const Ctx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, kind, text }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'err' ? 6000 : 3500)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg"
            role="status"
          >
            {t.kind === 'ok' ? <CheckCircle2 size={18} className="mt-px flex-none text-[#4ADE80]" /> : t.kind === 'err' ? <AlertTriangle size={18} className="mt-px flex-none text-[#FCA5A5]" /> : <Info size={18} className="mt-px flex-none text-primary-100" />}
            <span className="flex-1">{t.text}</span>
            <button onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))} className="text-white/60 hover:text-white" aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
