import React, { useEffect, useState } from 'react'
import useAudioPlayer from './useAudioPlayer'
import apiFetch from '../lib/api'

export default function EpisodesList({ podcastId }) {
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // queue is kept in-memory (persisted server-side in future). Remove localStorage usage.
  const [queue, setQueue] = useState([])

  const [watched, setWatched] = useState([])
  const [favorites, setFavorites] = useState([])
  const [watchedTracks, setWatchedTracks] = useState([])

  // load favorites from backend
  useEffect(() => {
    let cancelled = false
      ; (async () => {
        try {
          const res = await apiFetch('/episodes/favorites')
          if (!res.ok) return
          const data = await res.json()
          if (!cancelled) {
            const favIds = data.map((f) => {
              if (Array.isArray(f.items) && f.items.length) return f.items[0].id
              return null
            }).filter(Boolean)
            setFavorites(favIds)
          }
        } catch {
          // ignore
        }
      })()
    return () => { cancelled = true }
  }, [])

  const { play, playingId } = useAudioPlayer()

  useEffect(() => {
    if (!podcastId) return
    setLoading(true)
    setError(null)
    apiFetch(`/podcasts/${podcastId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Network error')
        return res.json()
      })
      .then((data) => {
        let eps = []
        if (data && Array.isArray(data.items)) {
          eps = data.items
        } else if (data && Array.isArray(data.results)) {
          eps = (data.results || []).filter((it) => it.wrapperType === 'podcastEpisode')
        }

        // normalize items
        const normalized = eps.map((it) => {
          const releaseDate = it.releaseDate || it.publishDate || (it.publish_date ? new Date(Number(it.publish_date) * 1000).toISOString() : null)
          return {
            episodeId: it.id,
            trackName: it.title,
            artistName: it.author || '',
            description: it.desc || '',
            releaseDate,
            episodeUrl: (it.downloaded ? `/api/episodes/${it.id}/download` : it.media_url),
            artworkUrl600: it.image_url,
            artworkUrl100: it.image_url,
            trackTimeMillis: undefined,
            __raw: it,
          }
        })

        setEpisodes(normalized)
        // map watched external track ids (fetched earlier) to episode ids
        if (watchedTracks && watchedTracks.length) {
          const watchedSet = new Set(watchedTracks.map(String))
          const watchedEpisodeIds = normalized.filter(e => watchedSet.has(String(e.__raw?.track_id ?? e.episodeId))).map(e => e.episodeId)
          if (watchedEpisodeIds.length) setWatched(watchedEpisodeIds)
        }
      })
      .catch((err) => setError(err.message || 'Failed to load episodes'))
      .finally(() => setLoading(false))
  }, [podcastId, watchedTracks])

  // load watched external track ids from backend for this podcast
  useEffect(() => {
    if (!podcastId) return
    let cancelled = false
      ; (async () => {
        try {
          const res = await apiFetch(`/episodes/watched?podcastId=${podcastId}`)
          if (!res.ok) return
          const data = await res.json()
          if (cancelled) return
          if (data && Array.isArray(data.watched)) {
            setWatchedTracks(data.watched)
          }
        } catch {
          // ignore network errors
        }
      })()
    return () => { cancelled = true }
  }, [podcastId])

  // queue is intentionally not persisted to localStorage anymore

  function getAudioUrl(ep) {
    return ep.episodeUrl || null
  }

  function getArtwork(ep) {
    return (
      ep.artworkUrl600 || ep.artworkUrl160 || ep.artworkUrl100 || ep.artworkUrl60 || ep.artworkUrl30 || null
    )
  }

  function formatDatePT(dateInput) {
    try {
      const d = new Date(dateInput)
      return d.toLocaleDateString('pt-PT', { year: 'numeric', month: 'long', day: 'numeric' })
    } catch {
      return ''
    }
  }

  function isQueued(id) {
    return queue.includes(id)
  }

  function isFavorited(id) {
    return favorites.includes(id)
  }

  function isWatched(id) {
    return watched.includes(id)
  }

  function toggleQueue(ep) {
    const id = ep.episodeId
    setQueue((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      return [id, ...prev]
    })
  }

  async function toggleWatched(ep) {
    const id = ep.episodeId
    if (!id) return
    if (isWatched(id)) {
      // unmark on server (by PodcastItem id)
      try {
        const res = await apiFetch(`/episodes/${id}/watched`, { method: 'DELETE' })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(text || `Server returned ${res.status}`)
        }
        setWatched((prev) => prev.filter((tid) => tid !== id))
      } catch (err) {
        console.error('Failed to unmark listened', err)
        alert('Failed to unmark as listened')
      }
    } else {
      // mark as listened on server (by PodcastItem id)
      try {
        const res = await apiFetch(`/episodes/${id}/watched`, { method: 'POST' })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          throw new Error(text || `Server returned ${res.status}`)
        }
        setWatched((prev) => (prev.includes(id) ? prev : [id, ...prev]))
        setQueue((prev) => prev.filter((qid) => qid !== id))
      } catch (err) {
        console.error('Failed to mark listened', err)
        alert('Failed to mark as listened')
      }
    }
  }

  function toggleFavorite(ep) {
    const id = ep.episodeId
    if (!id) return
    if (favorites.includes(id)) {
      // remove favorite on server (by PodcastItem id)
      apiFetch(`/episodes/${id}/favorite`, { method: 'DELETE' }).then((res) => {
        if (res.ok) setFavorites((prev) => prev.filter((tid) => tid !== id))
      }).catch(() => {
        // ignore
      })
    } else {
      // add favorite on server (by PodcastItem id)
      apiFetch(`/episodes/${id}/favorite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: null }) })
        .then((res) => res.json())
        .then(() => setFavorites((prev) => [id, ...prev]))
        .catch(() => {
          // ignore
        })
    }
  }

  function playEpisode(ep) {
    const url = getAudioUrl(ep)
    if (!url) return
    const meta = {
      id: ep.episodeId,
      title: ep.trackName,
      artist: ep.artistName,
      url: ep.episodeUrl,
      duration: ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 1000) : undefined,
    }
    play(ep.episodeId, ep.episodeUrl, meta)
  }

  async function downloadEpisode(ep) {
    const url = getAudioUrl(ep)
    if (!url) return alert('No audio URL available for this episode')
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch audio')
      const blob = await res.blob()
      const ext = (res.headers.get('content-type') || '').split('/').pop() || 'mp3'
      const filename = `${(ep.trackName || 'episode').replace(/[\\/:*?"<>|]/g, '')}.${ext}`
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(blobUrl)
    } catch (err) {
      console.error('Download failed', err)
      // fallback: open the audio URL in a new tab
      if (confirm('Direct download failed (CORS or network). Open audio URL in a new tab instead?')) {
        window.open(url, '_blank')
      }
    }
  }

  if (!podcastId) return null

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium mb-3">Episodes</h3>
      {loading && <div className="text-sm text-gray-500">Loading episodes…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {episodes.length === 0 && !loading && <div className="text-sm text-gray-500">No episodes found.</div>}
      <ul className="space-y-3">
        {episodes.map((ep) => {
          const audioUrl = getAudioUrl(ep)
          const artwork = getArtwork(ep)
          return (
            <li key={ep.episodeId} className="border rounded p-3">
              <div className="flex items-start gap-4">
                {artwork ? (
                  <img src={artwork} alt={ep.trackName || 'episode artwork'} className="w-16 h-16 object-cover rounded" />
                ) : (
                  <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-500">No Image</div>
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div className="font-semibold">{ep.trackName}</div>
                    {isWatched(ep.episodeId) ? (
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">Listened</span>
                    ) : isQueued(ep.episodeId) ? (
                      <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">Queued</span>
                    ) : null}
                  </div>
                  <div className="text-sm text-gray-600">{ep.releaseDate ? formatDatePT(ep.releaseDate) : ''}</div>
                  <div className="mt-2 text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: ep.description || '' }} />
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div>
                    <button
                      disabled={!audioUrl}
                      className={`h-9 w-9 rounded flex items-center justify-center ${playingId === ep.episodeId ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'} focus:outline-none focus:ring-2 focus:ring-blue-200`}
                      onClick={() => playEpisode(ep)}
                      aria-label={playingId === ep.episodeId ? `Pause ${ep.trackName}` : `Play ${ep.trackName}`}
                    >
                      {playingId === ep.episodeId ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                          <rect x="6" y="5" width="4" height="14" />
                          <rect x="14" y="5" width="4" height="14" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                          <path d="M5 3v18l15-9L5 3z" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <div>
                    <button
                      className={`h-9 px-3 rounded text-sm flex items-center justify-center ${isQueued(ep.episodeId) ? 'bg-gray-200 text-gray-700 border border-gray-300' : 'bg-orange-500 text-white'} focus:outline-none focus:ring-2 focus:ring-orange-200`}
                      onClick={() => toggleQueue(ep)}
                    >
                      {isQueued(ep.episodeId) ? 'Remove from queue' : 'Queue'}
                    </button>
                  </div>
                </div>
              </div>
              {/* New full-width row for favorite and mark-as-listened buttons */}
              <div className="mt-3 flex items-center gap-2 justify-end">
                <button
                  className="h-9 px-3 rounded text-sm flex items-center justify-center border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200"
                  onClick={() => downloadEpisode(ep)}
                  title="Download episode"
                >
                  Download
                </button>
                <button
                  className={`w-9 h-9 flex items-center justify-center rounded text-sm border focus:outline-none focus:ring-2 focus:ring-yellow-200 ${isFavorited(ep.episodeId) ? 'border-yellow-500 bg-yellow-50 text-yellow-700' : 'border-gray-300 text-yellow-600 bg-transparent'} hover:bg-yellow-50`}
                  onClick={() => toggleFavorite(ep)}
                  title={isFavorited(ep.episodeId) ? 'Unfavorite' : 'Favorite'}
                  aria-pressed={isFavorited(ep.episodeId)}
                >
                  {isFavorited(ep.episodeId) ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                    </svg>
                  )}
                </button>

                <button
                  className="w-9 h-9 flex items-center justify-center rounded text-sm border border-green-600 text-green-600 bg-transparent hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-200"
                  onClick={() => toggleWatched(ep)}
                  title={isWatched(ep.episodeId) ? 'Unmark as listened' : 'Mark as listened'}
                  aria-label={isWatched(ep.episodeId) ? 'Unmark as listened' : 'Mark as listened'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    <path d="M2.25 6.75C2.25 5.231 3.481 4 5 4h14c1.519 0 2.75 1.231 2.75 2.75v8.5C21.75 16.769 20.519 18 19 18H5c-1.519 0-2.75-1.231-2.75-2.75v-8.5zM12 11.293l6.146-4.47a.75.75 0 10-.892-1.22L12 9.56 6.746 5.603a.75.75 0 10-.892 1.22L12 11.293z" />
                  </svg>
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

