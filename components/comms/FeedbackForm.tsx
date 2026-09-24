'use client'
import { useState } from 'react'
import { CheckCircle2, Loader2, Star } from 'lucide-react'
import { api } from '@/components/client/api'
import { cx } from '@/lib/format'

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

export function FeedbackForm({ requestId }: { requestId: string }) {
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  if (done)
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <CheckCircle2 size={52} className="text-[#16A34A]" />
        <div className="mt-3 text-[20px] font-bold">Thank you!</div>
        <div className="mt-1 max-w-xs text-[15px] text-slate-600">Your feedback helps our home care team serve you better.</div>
      </div>
    )

  const shown = hover || rating
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (!rating) return setError('Please choose 1 to 5 stars')
        setBusy(true)
        setError('')
        try {
          await api(`/feedback/${requestId}`, { body: { rating, comment: comment.trim() || undefined } })
          setDone(true)
        } catch (err: any) {
          setError(err?.message ?? 'Could not send. Please try again.')
        } finally {
          setBusy(false)
        }
      }}
    >
      <div className="text-center text-[14px] text-slate-500">Tap a star to rate</div>
      <div className="mt-3 flex justify-center gap-1.5" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => setRating(n)}
            className="flex size-[52px] items-center justify-center rounded-xl transition active:scale-95"
          >
            <Star size={40} strokeWidth={1.6} className={cx('transition', n <= shown ? 'fill-[#F59E0B] text-[#F59E0B]' : 'text-slate-300')} />
          </button>
        ))}
      </div>
      <div className="mt-1 h-5 text-center text-[14px] font-semibold text-[#B45309]">{WORDS[shown]}</div>

      <label htmlFor="fb-comment" className="hc-label mt-4">
        Anything you would like to tell us? <span className="font-normal text-slate-400">(optional)</span>
      </label>
      <textarea id="fb-comment" className="hc-input hc-input-lg h-auto min-h-[110px] py-3" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What went well, what we can improve…" />

      {error && <div className="mt-3 rounded-lg bg-[#FEF2F2] px-3 py-2 text-[14px] text-[#B91C1C]">{error}</div>}

      <button type="submit" disabled={busy} className="mt-5 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-bold text-white transition hover:bg-primary-700 disabled:opacity-60">
        {busy && <Loader2 size={18} className="animate-spin" />} Send feedback
      </button>
    </form>
  )
}
