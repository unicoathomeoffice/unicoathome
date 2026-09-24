'use client'
import { Printer } from 'lucide-react'
import { btnClass } from '@/components/ui'

export function PrintButton() {
  return (
    <button type="button" className={btnClass('p')} onClick={() => window.print()}>
      <Printer size={16} /> Print / Save as PDF
    </button>
  )
}
