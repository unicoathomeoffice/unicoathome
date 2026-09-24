import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'

export default async function Home() {
  const u = await getUser()
  if (!u) redirect('/login')
  redirect(u.platformAccess.includes('web') && u.client === 'web' ? '/dashboard' : '/m')
}
