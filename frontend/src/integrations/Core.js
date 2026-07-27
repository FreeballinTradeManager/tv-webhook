import { api } from '../lib/api'

const API_KEY = import.meta.env.VITE_API_KEY || 'trading123'

// Multipart upload — separate from api() because that assumes JSON.
export async function UploadFile({ file }) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api/upload?key=${API_KEY}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`)
  return res.json() // { file_url: "..." }
}
