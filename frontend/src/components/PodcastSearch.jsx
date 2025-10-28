import React, { useState, useEffect, useRef } from 'react'
import apiFetch from '../lib/api'
import SavedPodcasts from './SavedPodcasts'

function useDebouncedValue(value, delay = 400) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

export default function PodcastSearch() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 450)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // per-item saving state (list of collectionIds currently being saved/removed)
  const [savingIds, setSavingIds] = useState([])
  const abortRef = useRef(null)
  const inputRef = useRef(null)
  // saved podcasts are loaded from backend
  const [saved, setSaved] = useState([])

  useEffect(() => {
    let cancelled = false
      ; (async () => {
        try {
          const res = await apiFetch('/podcasts')
          if (!res.ok) return
          const data = await res.json()
          if (!Array.isArray(data) || data.length === 0) return
          const mapped = data.map((p) => ({
            podcastId: p.id,
            collectionId: p.itunes_id || null,
            collectionName: p.title || '',
            artistName: p.artist || '',
            artworkUrl600: p.image_url || null,
            artworkUrl100: p.image_url || null,
            artworkUrl60: p.image_url || null,
            feedUrl: p.rss_url || null,
            totalEpisodes: p.trackCount || 0,
            suspended: p.suspended || 0,
            addedAt: p.date * 1000 || undefined,
          }))
          if (!cancelled) setSaved(mapped)
        } catch {
          // ignore
        }
      })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!debouncedQuery) {
      setResults([])
      setError(null)
      return
    }

    const term = encodeURIComponent(debouncedQuery)

    setLoading(true)
    setError(null)
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    apiFetch(`/itunes/search?q=${term}&limit=2`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('Network response was not ok')
        return res.json()
      })
      .then((data) => {
        setResults(data.results || [])
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message || 'Failed to fetch')
      })
      .finally(() => setLoading(false))

    return () => {
      controller.abort()
    }
  }, [debouncedQuery])

  // Hide results on Escape key and blur the input
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        setResults([])
        setError(null)
        if (inputRef.current && typeof inputRef.current.blur === 'function') inputRef.current.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function toggleSave(podcast) {
    // Always consult backend for authoritative existence by itunes id.
    setError(null)
    const key = podcast.collectionId
    // mark this id as saving
    setSavingIds((prev) => (prev.includes(key) ? prev : [...prev, key]))
    try {
      const listRes = await apiFetch('/podcasts')
      if (!listRes.ok) throw new Error(`Failed to fetch saved podcasts: ${listRes.status}`)
      const list = await listRes.json()
      const existing = list.find((p) => Number(p.itunes_id) === Number(podcast.collectionId))

      if (existing) {
        // delete the existing saved podcast
        const del = await apiFetch(`/podcasts/${existing.id}`, { method: 'DELETE' })
        if (!del.ok) throw new Error(`Server returned ${del.status}`)
        // update local saved cache
        setSaved((prev) => prev.filter((p) => p.collectionId !== podcast.collectionId))
        return
      }

      // not found -> add
      const payload = {
        itunes_id: Number(podcast.collectionId),
        title: podcast.collectionName,
        artist: podcast.artistName,
        genre: podcast.primaryGenreName || null,
        rss_url: podcast.feedUrl || '',
        image_url: podcast.artworkUrl600 || podcast.artworkUrl100 || podcast.artworkUrl60 || null,
      }

      const res = await apiFetch('/podcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `Server returned ${res.status}`)
      }

      const created = await res.json()
      const mapped = {
        podcastId: created.id,
        collectionId: created.itunes_id || null,
        collectionName: created.title || '',
        artistName: created.artist || '',
        artworkUrl600: created.image_url || null,
        artworkUrl100: created.image_url || null,
        artworkUrl60: created.image_url || null,
        feedUrl: created.rss_url || null,
        totalEpisodes: created.trackCount || 0,
        suspended: created.suspended || 0,
        addedAt: created.date * 1000 || undefined,
      }

      setSaved((prev) => [mapped, ...prev])
    } catch (err) {
      setError(err.message || 'Failed to toggle saved podcast')
    } finally {
      // remove saving mark
      setSavingIds((prev) => prev.filter((id) => id !== key))
    }
  }

  function isSaved(collectionId) {
    return saved.some((p) => p.collectionId === collectionId)
  }

  // parent handlers to update saved list when child reports suspend/resume
  function handleSuspend(podcast) {
    if (!podcast || !podcast.podcastId) return
    const id = podcast.podcastId
    setSaved((prev) => prev.map((p) => (p.podcastId === id ? { ...p, suspended: 1 } : p)))
  }

  function handleResume(podcast) {
    if (!podcast || !podcast.podcastId) return
    const id = podcast.podcastId
    setSaved((prev) => prev.map((p) => (p.podcastId === id ? { ...p, suspended: 0 } : p)))
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <label className="block text-sm font-medium text-gray-700 mb-2">Search podcasts</label>
      <div className="flex gap-2">
        <input
          ref={inputRef}
          className="flex-1 border rounded px-3 py-2"
          placeholder="Search by podcast name or author"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="px-3 py-2 bg-blue-600 text-white rounded"
          onClick={() => setQuery('')}
          title="Clear"
        >
          Clear
        </button>
      </div>

      <div className="mt-4">
        {loading && <div className="text-sm text-gray-500">Loading…</div>}
        {error && <div className="text-sm text-red-600">Error: {error}</div>}
        {!loading && !error && results.length === 0 && debouncedQuery && (
          <div className="text-sm text-gray-500">No results</div>
        )}

        <ul className="mt-3 space-y-3">
          {results.map((r) => (
            <li key={r.collectionId} className="flex items-center gap-3 p-2 border rounded">
              <img src={r.artworkUrl60} alt="art" width={60} height={60} className="rounded" />
              <div>
                <a href={`#/podcast/${r.podcastId}`} className="font-semibold text-blue-600 hover:underline">{r.collectionName}</a>
                <div className="text-sm text-gray-600">{r.artistName}</div>
              </div>
              <div className="ml-auto flex items-center gap-3">
                <div className="text-sm text-gray-500">Episodes: {r.trackCount ?? '-'}</div>
                <button
                  className={`px-2 py-1 rounded text-sm ${isSaved(r.collectionId) ? 'bg-gray-200' : 'bg-green-600 text-white'}`}
                  onClick={() => toggleSave(r)}
                  disabled={savingIds.includes(r.collectionId)}
                >
                  {isSaved(r.collectionId) ? 'Remove' : (savingIds.includes(r.collectionId) ? 'Saving...' : 'Save')}
                </button>
              </div>
            </li>
          ))}
        </ul>

        <SavedPodcasts saved={saved} onToggle={toggleSave} onSuspend={handleSuspend} onResume={handleResume} />
      </div>
    </div>
  )
}
