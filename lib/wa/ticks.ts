// WhatsApp ticks (pure, no imports): a receipt only ever moves a message forward — sent ✓ → delivered ✓✓ → read (blue ✓✓).

export type Receipt = 'DELIVERED' | 'OPENED'
const RANK: Record<string, number> = { SENT: 1, SENT_CONFIRMED: 1, DELIVERED: 2, OPENED: 3 }

/** The status after a receipt, or null when nothing changes (not sent yet, failed, or already further on). */
export function nextStatus(current: string, receipt: Receipt): Receipt | null {
  const now = RANK[current]
  if (!now) return null // PENDING / QUEUED / FAILED / SKIPPED … — never touched by a receipt
  return RANK[receipt] > now ? receipt : null
}

/** WhatsApp's numeric message status (proto WebMessageInfo.Status) → our receipt: 3 delivered · 4 read · 5 played. */
export function receiptOf(status: unknown): Receipt | null {
  const n = Number(status ?? 0)
  return n >= 4 ? 'OPENED' : n === 3 ? 'DELIVERED' : null
}
