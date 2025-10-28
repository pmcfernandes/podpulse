export function isDebug() {
  try {
    const host = typeof window !== 'undefined' && window.location && window.location.hostname
    return host === '127.0.0.1' || host === 'localhost'
  } catch {
    return false
  }
}

export function apiBase() {
  return isDebug() ? 'http://127.0.0.1:8000/api' : '/api'
}

export function apiFetch(path, options) {
  // If a full URL is provided, pass-through. Otherwise prefix with apiBase()
  const isFull = typeof path === 'string' && /^https?:\/\//i.test(path)
  const base = apiBase()
  const url = isFull ? path : (path.startsWith('/') ? base + path : base + '/' + path)
  return fetch(url, options)
}

export default apiFetch
