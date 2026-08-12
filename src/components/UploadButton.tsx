'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [notices, setNotices] = useState<string[]>([])
  // W6: a successful merge should hand you the next step, not a silent refresh
  const [successes, setSuccesses] = useState<{ name: string; serviceId: string; songs: number; merged: boolean }[]>([])
  const router = useRouter()

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    setErrors([])
    setNotices([])
    setSuccesses([])
    const errs: string[] = []
    const notes: string[] = []
    const oks: typeof successes = []

    for (let i = 0; i < files.length; i++) {
      setProgress({ current: i + 1, total: files.length })

      const formData = new FormData()
      formData.append('file', files[i])

      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        errs.push(`${files[i].name}: ${data.error ?? 'Upload failed'}`)
      } else {
        if (data.service_id) {
          oks.push({ name: files[i].name, serviceId: data.service_id, songs: data.songs ?? 0, merged: !!data.replaced })
        }
        if (data.replaced && data.notes_restored > 0) {
          notes.push(`${files[i].name}: ${data.notes_restored} personal note${data.notes_restored === 1 ? '' : 's'} preserved`)
        }
        if (data.warning) notes.push(`${files[i].name}: ${data.warning}`)
      }
    }

    setProgress(null)
    if (inputRef.current) inputRef.current.value = ''

    if (errs.length) setErrors(errs)
    if (notes.length) setNotices(notes)
    setSuccesses(oks)
    router.refresh()
  }

  const uploading = progress !== null

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        multiple
        className="hidden"
        onChange={handleFiles}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="bg-white text-black text-sm font-semibold rounded-xl px-4 py-2 disabled:opacity-50 active:scale-95 transition-transform"
      >
        {uploading
          ? progress!.total > 1
            ? `Uploading ${progress!.current} / ${progress!.total}…`
            : 'Uploading…'
          : 'Upload chart'}
      </button>
      {successes.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {successes.map((s, i) => (
            <p key={i} className="text-xs text-green-400">
              {s.merged ? 'Chart merged' : 'Chart uploaded'} ({s.songs} songs) —{' '}
              <Link href={`/services/${s.serviceId}`} className="underline underline-offset-2 font-semibold">
                view service →
              </Link>
            </p>
          ))}
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {errors.map((err, i) => (
            <p key={i} className="text-red-400 text-xs">{err}</p>
          ))}
        </div>
      )}
      {notices.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {notices.map((n, i) => (
            <p key={i} className="text-amber-400 text-xs">{n}</p>
          ))}
        </div>
      )}
    </div>
  )
}
