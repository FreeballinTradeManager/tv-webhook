// Central fetch wrapper for all API calls to our Railway backend.
// In dev, Vite proxies /api to localhost:8000 (see vite.config.js).
// In prod, FastAPI serves the built bundle from /, so /api is same-origin.

const API_KEY = import.meta.env.VITE_API_KEY || 'trading123'

function withKey(path, method) {
  if (method === 'GET' || method === 'HEAD') return path
  const sep = path.includes('?') ? '&' : '?'
  return `${path}${sep}key=${API_KEY}`
}

export async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }
  const res = await fetch(withKey(path, method), opts)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  if (res.status === 204) return null
  return res.json()
}
