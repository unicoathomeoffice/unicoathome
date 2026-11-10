import { MScreen } from '@/components/mobile'
import { FHeader, vHref, fullAddress } from '@/components/field'
import { loadVisit } from '@/components/field/data'
import { directionsUrl, embedRouteUrl, embedUrl } from '@/lib/maps'

export const metadata = { title: 'Directions' }

/** Directions inside the app (keyless Google embed): staff stay on screen, so their live location keeps flowing —
 *  opening the Google Maps app pauses it (browsers only share location while the app is open). */
export default async function Directions({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { r, patient } = await loadVisit(id)
  const to = { lat: patient?.address?.lat, lng: patient?.address?.lng, address: fullAddress(patient, r.patientSnapshot?.address) }
  const from = r.tracking?.lat != null ? { lat: r.tracking.lat, lng: r.tracking.lng } : null
  const src = (from && embedRouteUrl([from, to])) || embedUrl(to)
  return (
    <MScreen header={<FHeader back={vHref(id)} title="Directions" sub={`${r.patientSnapshot?.name ?? ''} · ${r.patientSnapshot?.area ?? ''}`} />} pad={false}>
      <div className="flex h-[calc(100dvh-170px)] min-h-[360px] flex-col">
        <iframe title="Route to the patient" src={src} className="w-full flex-1 border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        <div className="flex flex-col gap-2 bg-white px-4 py-3">
          <div className="text-[13px] text-slate-600">{to.address}</div>
          <a href={directionsUrl(to)} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center rounded-xl border-[1.5px] border-slate-300 text-[14px] font-semibold text-primary-700">
            Open in Google Maps app
          </a>
          <div className="text-center text-[11.5px] text-[#B45309]">Your live location pauses while you are in another app — come back here to keep sharing it.</div>
        </div>
      </div>
    </MScreen>
  )
}
