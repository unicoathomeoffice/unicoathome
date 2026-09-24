import type { Metadata } from 'next'
import Link from 'next/link'
import { requireWebUser } from '@/lib/auth'
import { HomecareRequest } from '@/lib/models'
import { PLACEHOLDERS } from '@/lib/templates'
import { AdminPage } from '@/components/admin/AdminPage'
import { TemplateEditor } from '@/components/settings/TemplateEditor'
import { getTemplateFull, listTemplates } from '@/app/api/v1/templates/_shared'
import { cx } from '@/lib/format'

export const metadata: Metadata = { title: 'Templates' }

const CH: Record<string, string> = { EMAIL: 'Email', WHATSAPP: 'WhatsApp', PUSH: 'Push' }

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const user = await requireWebUser('templates.manage')
  const { key } = await searchParams
  const list = await listTemplates()
  const current = list.find((t) => t.key === key) ?? list[0]
  const [full, recent] = await Promise.all([
    getTemplateFull(current.key),
    HomecareRequest.find({ deletedAt: null }).sort({ 'timeline.requestedAt': -1 }).limit(20).select('requestNo patientSnapshot.name assignment.primaryStaffId').lean<any[]>(),
  ])
  // requests with an assigned staff member first — they fill {staffName} / {designation}
  const requests = [...recent.filter((r) => r.assignment?.primaryStaffId), ...recent.filter((r) => !r.assignment?.primaryStaffId)].map((r) => ({ id: String(r._id), requestNo: r.requestNo, patientName: r.patientSnapshot?.name ?? '' }))

  return (
    <AdminPage title={`Templates · ${current.key}`}>
      <div className="grid items-start gap-4 lg:grid-cols-[232px_minmax(0,1fr)]">
        <nav className="overflow-hidden rounded-card bg-white shadow-card">
          <div className="border-b border-slate-100 px-4 py-3 text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500">Message templates · {list.length}</div>
          {list.map((t) => (
            <Link
              key={t.key}
              href={`/settings/templates?key=${t.key}`}
              scroll={false}
              className={cx('block border-b border-slate-100 px-4 py-2.5 last:border-0', t.key === current.key ? 'bg-primary-50' : 'hover:bg-slate-50')}
            >
              <div className="flex items-center gap-2">
                <span className={cx('min-w-0 flex-1 truncate text-[13.5px]', t.key === current.key ? 'font-bold text-primary-700' : 'font-semibold')}>{t.name}</span>
                {!t.isActive && <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-bold uppercase text-slate-600">Off</span>}
                {t.customised && <span className="font-mono text-[10.5px] text-slate-400">v{t.version}</span>}
              </div>
              <div className="truncate text-[11.5px] text-slate-500">
                {t.audience} · {t.channel.map((c) => CH[c] ?? c).join(' / ')}
              </div>
            </Link>
          ))}
        </nav>
        <TemplateEditor tpl={full!.template} history={full!.history} requests={requests} placeholders={PLACEHOLDERS} myEmail={user.email} />
      </div>
    </AdminPage>
  )
}
