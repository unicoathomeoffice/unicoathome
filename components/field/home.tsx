'use client'
import { useEffect, useState } from 'react'
import { api, useAction, Segmented } from '@/components/client'
import { AVAILABILITY_LABEL } from '@/lib/constants'

type Av = keyof typeof AVAILABILITY_LABEL

/** On duty / Off duty / On leave — PATCH /users/me, optimistic. */
export function AvailabilitySeg({ value, h = 36 }: { value: string; h?: number }) {
  const [v, setV] = useState<Av>((value as Av) ?? 'ON_DUTY')
  const { run } = useAction()
  return (
    <Segmented<Av>
      h={h}
      value={v}
      items={(Object.keys(AVAILABILITY_LABEL) as Av[]).map((k) => ({ value: k, label: AVAILABILITY_LABEL[k] }))}
      onChange={async (next) => {
        if (next === v) return
        const prev = v
        setV(next)
        const ok = await run(() => api('/users/me', { method: 'PATCH', body: { availability: next } }), `You are ${AVAILABILITY_LABEL[next].toLowerCase()}`)
        if (!ok) setV(prev)
      }}
    />
  )
}

/** "in 42 min" · "in 1 h 5 min" · "now" · "started 12 min ago" (updates every 30 s) */
export function InMin({ to, started }: { to: string; started?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const m = Math.round((new Date(to).getTime() - now) / 60000)
  const f = (x: number) => (x < 60 ? `${x} min` : `${Math.floor(x / 60)} h${x % 60 ? ` ${x % 60} min` : ''}`)
  if (started) return <>started {f(Math.max(0, -m))} ago</>
  if (m > 0) return <>in {f(m)}</>
  if (m === 0) return <>now</>
  return <>{f(-m)} overdue</>
}
