import { MScreen } from '@/components/mobile'
import { loadVisit, coordinatorOnDuty } from '@/components/field/data'
import { ChatScreen } from '@/components/field/chat'
import { ChatMessage, User } from '@/lib/models'
import { plain } from '@/lib/db'
import { relDay, time } from '@/lib/format'

export const metadata = { title: 'Chat' }

/** C1 (6d) Visit chat */
export default async function Chat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { r, user, team } = await loadVisit(id)
  const [rows, coord] = await Promise.all([ChatMessage.find({ requestId: r._id }).sort({ createdAt: 1 }).limit(500).lean<any[]>(), coordinatorOnDuty()])
  const users = await User.find({ _id: { $in: rows.map((m) => m.senderId).filter(Boolean) } })
    .select('name role')
    .lean<any[]>()
  await ChatMessage.updateMany({ requestId: r._id, readBy: { $ne: user.id } }, { $addToSet: { readBy: user.id } })
  const items = rows.map((m) => {
    const u = users.find((x) => String(x._id) === String(m.senderId))
    return {
      id: String(m._id),
      kind: m.kind ?? 'TEXT',
      text: m.text ?? '',
      attachmentId: m.attachmentId ? String(m.attachmentId) : null,
      at: m.createdAt,
      mine: !!m.senderId && String(m.senderId) === user.id,
      sender: u ? { id: String(u._id), name: u.name, role: u.role } : null,
    }
  })
  // staff talk to the coordinator; coordinators talk to the primary staff member
  const other = team ? { name: coord?.name ?? 'Coordinator', label: 'Coordinator', phone: coord?.phone } : { name: r.primaryStaff?.name ?? 'Care team', label: 'Care team', phone: r.primaryStaff?.phone }
  return (
    <MScreen pad={false}>
      <ChatScreen
        id={id}
        initial={plain(items)}
        title={other.name}
        sub={`${other.label} · ${r.requestNo}`}
        callPhone={other.phone}
        visit={{ requestNo: r.requestNo, patient: r.patientSnapshot?.name, when: r.scheduledAt ? `${relDay(r.scheduledAt)} ${time(r.scheduledAt)}` : '—', status: r.status }}
      />
    </MScreen>
  )
}
