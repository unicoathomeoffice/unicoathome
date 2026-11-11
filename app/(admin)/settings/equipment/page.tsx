import { redirect } from 'next/navigation'

/** The store moved to its own place in the sidebar. */
export default function OldEquipmentPage() {
  redirect('/store')
}
