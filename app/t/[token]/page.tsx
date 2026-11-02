import type { Metadata } from 'next'
import { TrackClient } from './TrackClient'

export const metadata: Metadata = { title: 'Your care team · live', robots: { index: false, follow: false } }

/** Patient's live tracking link (sent on WhatsApp when the team starts the journey). No sign-in: the token is the key. */
export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <TrackClient token={token} />
}
