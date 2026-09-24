'use client'
// M07 Check-in: live time stamp preview, punctuality, optional GPS with accuracy, one confirm.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, LocateOff } from 'lucide-react'
import { stamp, Toggle, useToast } from '@/components/client'
import { MapBox, Avatar } from '@/components/ui'
import { cx, time } from '@/lib/format'
import { sendOrQueue } from './live'
import { BottomBar, bigBtn } from './bar'

type Fix = { lat: number; lng: number; acc: number } | null

export function CheckInForm({ id, scheduledAt, patient, area, address, lateAfter = 10, status }: { id: string; scheduledAt?: string; patient: string; area?: string; address?: string; lateAfter?: number; status: string }) {
  const router = useRouter()
  const toast = useToast()
  const [now, setNow] = useState(() => Date.now())
  const [gps, setGps] = useState(true)
  const [fix, setFix] = useState<Fix>(null)
  const [gpsState, setGpsState] = useState<'idle' | 'locating' | 'ok' | 'error'>('idle')
  const [gpsErr, setGpsErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!gps) return
    if (!('geolocation' in navigator)) {
      setGpsState('error')
      setGpsErr('This phone does not share location')
      return
    }
    setGpsState('locating')
    const w = navigator.geolocation.watchPosition(
      (p) => {
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) })
        setGpsState('ok')
      },
      (e) => {
        setGpsState('error')
        setGpsErr(e.code === 1 ? 'Location permission denied' : 'Could not get a GPS fix')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
    return () => navigator.geolocation.clearWatch(w)
  }, [gps])

  const late = scheduledAt ? Math.round((now - new Date(scheduledAt).getTime()) / 60000) : null
  const isLate = late != null && late > lateAfter
  const canCheckIn = ['ACCEPTED', 'EN_ROUTE'].includes(status)

  async function confirm() {
    setBusy(true)
    try {
      const body = { ...stamp(), ...(gps && fix ? { lat: fix.lat, lng: fix.lng, accuracyM: fix.acc } : {}) }
      const res = await sendOrQueue(`/requests/${id}/check-in`, body, { label: 'Check-in' })
      toast(res.queued ? `Check-in saved offline · ${time(new Date())} · will sync` : `Checked in · ${time(new Date())}`, 'ok')
      router.push(res.queued ? `/m/visits/${id}` : `/m/visits/${id}/checklist`)
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
      setBusy(false)
    }
  }

  return (
    <>
      <div className="relative">
        <MapBox height={220} note={gps ? (gpsState === 'ok' && fix ? `GPS ±${fix.acc} m${area ? ` · ${area}` : ''}` : gpsState === 'locating' ? 'Locating…' : gpsErr || 'GPS off') : 'GPS off · time stamp only'}>
          {gps && gpsState === 'ok' && fix ? (
            <>
              <div
                className="absolute left-1/2 top-[55%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/30 bg-primary/12"
                style={{ width: Math.max(48, Math.min(180, fix.acc * 3)), height: Math.max(48, Math.min(180, fix.acc * 3)) }}
              />
              <div className="absolute left-1/2 top-[55%] size-[26px] bg-primary shadow-md" style={{ borderRadius: '50% 50% 50% 0', transform: 'translate(-50%,-100%) rotate(-45deg)' }} />
            </>
          ) : gps && gpsState === 'locating' ? (
            <Loader2 size={28} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-primary" />
          ) : (
            <LocateOff size={28} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-slate-400" />
          )}
        </MapBox>
      </div>

      <div className="rounded-card bg-white p-4 shadow-card">
        <div className="flex items-center gap-3.5">
          <Avatar name={patient} size={48} />
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-bold">{patient}</div>
            <div className="truncate text-[13px] text-slate-500">{address}</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-[10px] bg-slate-100 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-slate-500">Scheduled</div>
            <div className="text-[24px] font-bold">{scheduledAt ? time(scheduledAt) : '—'}</div>
          </div>
          <div className="rounded-[10px] bg-primary-50 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-primary-700">Check-in now</div>
            <div className="text-[24px] font-bold text-primary-700" suppressHydrationWarning>{time(now)}</div>
          </div>
        </div>
        {late != null && (
          <div className={cx('mt-3 flex items-start gap-2 text-[13px] font-semibold', isLate ? 'text-[#B45309]' : 'text-[#15803D]')}>
            {isLate ? <AlertTriangle size={16} className="mt-px flex-none" /> : <CheckCircle2 size={16} className="mt-px flex-none" />}
            <span>
              {isLate
                ? `${late} min late · flagged to the coordinator (late after +${lateAfter})`
                : late < 0
                  ? `${-late} min early · on time`
                  : `+${late} min · on time (late flag after +${lateAfter})`}
            </span>
          </div>
        )}
      </div>

      <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold">Attach GPS position</div>
            <div className="text-[12px] text-slate-500">{gps && gpsState === 'error' ? `${gpsErr} · you can still check in` : 'Optional · stored with the timestamp'}</div>
          </div>
          <Toggle on={gps} onChange={setGps} label="Attach GPS position" />
        </div>
      </div>
      <div className="text-center text-[12px] leading-[18px] text-slate-400">Works offline. The time is stamped from your device and reconciled when you reconnect.</div>

      <BottomBar>
        <button type="button" disabled={busy || !canCheckIn} onClick={confirm} className={bigBtn(canCheckIn ? 'p' : 'd')}>
          {busy && <Loader2 size={18} className="animate-spin" />}
          {canCheckIn ? `Confirm check-in · ${time(now)}` : status === 'IN_PROGRESS' ? 'Already checked in' : 'Accept the visit first'}
        </button>
      </BottomBar>
    </>
  )
}
