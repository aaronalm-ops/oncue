'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')

    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Upload failed')
    } else {
      router.push(`/services/${data.service_id}`)
      router.refresh()
    }
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={handleFile}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="bg-white text-black text-sm font-semibold rounded-xl px-4 py-2 disabled:opacity-50 active:scale-95 transition-transform"
      >
        {uploading ? 'Uploading…' : 'Upload chart'}
      </button>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  )
}
