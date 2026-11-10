'use client'
// Staff list: give someone from the HIS a HomeCare phone-app login, or send a fresh PIN (WhatsApp, via the Outbox).
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, Loader2 } from 'lucide-react'
import { api, useToast } from '@/components/client'

export function AppLoginButton({ userId, name, hasLogin }: { userId: string; name: string; hasLogin: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function go() {
    if (!confirm(hasLogin ? `Send ${name} a new temporary PIN for the HomeCare app? The old one stops working.` : `Give ${name} a login to the HomeCare phone app? A temporary PIN goes to their WhatsApp.`)) return
    setBusy(true)
    try {
      const r = await api<{ loginSent?: boolean; pin?: string }>(`/users/${userId}/app-login`, { body: {} })
      if (r.pin) alert(`${name} has no WhatsApp number.\n\nTemporary PIN: ${r.pin}\n\nGive it to them; they change it after signing in.`)
      toast(r.loginSent ? 'Login ready — check and send it in the WhatsApp review' : 'App login created', 'ok')
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={go} disabled={busy} className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary-700 hover:underline disabled:opacity-50">
      {busy ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} {hasLogin ? 'New PIN' : 'Give app login'}
    </button>
  )
}
