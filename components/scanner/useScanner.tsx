'use client'
import { useCallback, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import type { ScanOptions } from './DocScanner'

// the editor (and its image code) loads only when someone actually scans
const DocScanner = dynamic(() => import('./DocScanner').then((m) => m.DocScanner), { ssr: false })

type Job = { files: File[]; opts: ScanOptions; finish: (out: File[] | null) => void }

/**
 * Route picked files through the document scanner. Photos open the editor; PDFs and other files pass straight
 * through. Resolves with the files to upload, or null when the person closed the scanner with nothing to keep.
 *
 *   const { scan, scanner } = useScanner()
 *   onChange={async (e) => { const files = await scan(e.target.files); if (files) upload(files) }}
 *   … {scanner}
 */
export function useScanner(): { scan: (input: FileList | File[] | null | undefined, opts?: ScanOptions) => Promise<File[] | null>; scanner: ReactNode } {
  const [job, setJob] = useState<Job | null>(null)
  const scan = useCallback((input: FileList | File[] | null | undefined, opts: ScanOptions = {}) => {
    const all = Array.from(input ?? [])
    const photos = all.filter((f) => f.type.startsWith('image/'))
    const others = all.filter((f) => !f.type.startsWith('image/'))
    if (!photos.length) return Promise.resolve(others.length ? others : null)
    return new Promise<File[] | null>((resolve) =>
      setJob({
        files: photos,
        opts,
        finish: (out) => {
          setJob(null)
          const files = [...(out ?? []), ...others]
          resolve(files.length ? files : null)
        },
      }),
    )
  }, [])
  const scanner = job ? <DocScanner {...job.opts} files={job.files} onDone={(f) => job.finish(f)} onCancel={() => job.finish(null)} /> : null
  return { scan, scanner }
}
