import type { Metadata } from 'next'
import { StaffVisitLink } from './StaffVisitLink'

export const metadata: Metadata = { title: 'Your visit · bag & checklist', robots: { index: false, follow: false } }

/** No-login staff link (sent on WhatsApp when assigned): the visit's bag and checklist. The token + employee ID are the key. */
export default async function StaffLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <StaffVisitLink token={token} />
}
