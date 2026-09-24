'use client'
import { FileText } from 'lucide-react'
import { btnClass } from '@/components/ui'

/** "PDF" = the browser's print dialog on a print-friendly layout (Save as PDF). */
export function PrintButton({ label = 'PDF' }: { label?: string }) {
  return (
    <button type="button" className={btnClass('p', 'md')} onClick={() => window.print()} title="Print or save as PDF">
      <FileText size={16} /> {label}
    </button>
  )
}

/**
 * Print stylesheet: only the element marked [data-print-root] is printed, at full height
 * (the admin shell's fixed-height scroll containers would otherwise clip it to one page).
 */
export function PrintStyles() {
  return (
    <style>{`
@media print {
  @page { size: A4; margin: 12mm; }
  body * { visibility: hidden !important; }
  [data-print-root], [data-print-root] * { visibility: visible !important; }
  [data-print-root] { position: absolute !important; left: 0; top: 0; width: 100% !important; padding: 0 !important; }
  .h-dvh, main { height: auto !important; overflow: visible !important; }
  [data-print-root] .shadow-card { box-shadow: none !important; border: 1px solid #E2E8F0; }
  [data-print-root] .break-inside-avoid { break-inside: avoid; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`}</style>
  )
}
