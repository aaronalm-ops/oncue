'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const router = useRouter()

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    setErrors([])
    const errs: string[] = []

    for (let i = 0; i < files.length; i++) {
      setProgress({ current: i + 1, total: files.length })

      const formData = new FormData()
      formData.append('file', files[i])

      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        errs.push(`${files[i].name}: ${data.error ?? 'Upload failed'}`)
      }
    }

    setProgress(null)
    if (inputRef.current) inputRef.current.value = ''

    if (errs.length) setErrors(errs)
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
      {errors.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {errors.map((err, i) => (
            <p key={i} className="text-red-400 text-xs">{err}</p>
          ))}
        </div>
      )}
    </div>
  )
}
