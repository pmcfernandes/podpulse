import React, { useEffect, useState } from 'react'
import useAudioPlayer from './useAudioPlayer'
import apiFetch from '../lib/api'

const FAVORITES_KEY = 'favoriteEpisodes'

export default function Favorites() {
  // favorites are stored on the server; we only track episode details locally
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const { play, playingId } = useAudioPlayer()
  const [pendingIds, setPendingIds] = useState([])

  useEffect(() => {
    // load favorite ids from backend then lookup details
    let cancelled = false
      ; (async () => {
        try {
          setLoading(true)
          const res = await apiFetch('/episodes/favorites')
          if (!res.ok) throw new Error('Network error')
          const favs = await res.json()
          // favs contains favorites with an `items` array (PodcastItem rows) per favorite
          const items = []
          for (const f of favs) {
            const its = Array.isArray(f.items) ? f.items : []
            for (const it of its) {
              // normalize PodcastItem -> expected episode shape used by this component
              items.push({
                episodeId: it.id || null,
                trackName: it.title || it.trackName || '',
                artistName: it.author || it.artistName || '',
                artworkUrl100: it.image_url || it.artworkUrl100 || null,
                episodeUrl: (it.downloaded ? `/api/episodes/${it.id}/download` : it.media_url),
                releaseDate: it.publish_date ? new Date(Number(it.publish_date) * 1000).toISOString() : null,
                // keep raw item attached in case UI needs more fields
                __raw: it,
              })
            }
          }
          // sort newest-first by releaseDate
          items.sort((a, b) => {
            const ta = a.releaseDate ? Date.parse(a.releaseDate) : 0
            const tb = b.releaseDate ? Date.parse(b.releaseDate) : 0
            return tb - ta
          })
          if (!cancelled) setEpisodes(items)
        } catch (err) {
          if (!cancelled) setError(err.message || 'Failed to load favorites')
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    return () => { cancelled = true }
  }, [])

  function unfavorite(id) {
    // optimistic update: remove immediately, then call server
    if (!id) return
    // remember previous list to revert if needed
    const previous = episodes
  setEpisodes((prev) => prev.filter((e) => e.episodeId !== id))
    setPendingIds((s) => (s.includes(id) ? s : [...s, id]))

    apiFetch(`/episodes/${id}/favorite`, { method: 'DELETE' })
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`)
        // success — remove pending flag
        setPendingIds((s) => s.filter((pid) => pid !== id))
      })
      .catch((err) => {
        // revert optimistic change
        setEpisodes(previous)
        setPendingIds((s) => s.filter((pid) => pid !== id))
        setError(err?.message || 'Failed to remove favorite')
      })
  }


  function getAudioUrl(ep) {
    return ep.episodeUrl ||  null
  }

  function getArtwork(ep) {
    return ep.artworkUrl100 || ep.artworkUrl600 || (ep.__raw && (ep.__raw.image_url || ep.__raw.artworkUrl100)) || null
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
      if (confirm('Direct download failed (CORS or network). Open audio URL in a new tab instead?')) {
        window.open(url, '_blank')
      }
    }
  }

  function formatDatePT(dateInput) {
    try {
      const d = new Date(dateInput)
      return d.toLocaleDateString('pt-PT', { year: 'numeric', month: 'long', day: 'numeric' })
    } catch {
      return ''
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
    play(ep.episodeId, url, meta)
  }

  if (!episodes || episodes.length === 0) return <div className="max-w-4xl mx-auto p-4">No favorites yet.</div>

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h2 className="text-xl font-medium mb-3">Favorites</h2>
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
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
                  </div>
                  <div className="text-sm text-gray-600">{ep.artistName}</div>
                  <div className="text-sm text-gray-500">{ep.releaseDate ? formatDatePT(ep.releaseDate) : ''}</div>
                  <div className="mt-2 text-sm text-gray-700" dangerouslySetInnerHTML={{ __html: (ep.__raw && (ep.__raw.desc || ep.__raw.description)) || '' }} />
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
                </div>
              </div>

              {/* New full-width row for unfavorite and download buttons */}
              <div className="mt-3 flex items-center gap-2 justify-end">
                <button
                  className="h-9 px-3 rounded text-sm flex items-center justify-center border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-200"
                  onClick={() => downloadEpisode(ep)}
                  title="Download episode"
                >
                  Download
                </button>
                <button
                  className={`w-9 h-9 flex items-center justify-center rounded text-sm border ${pendingIds.includes(ep.episodeId) ? 'opacity-50 cursor-not-allowed' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}`}
                  onClick={() => unfavorite(ep.episodeId)}
                  disabled={pendingIds.includes(ep.episodeId)}
                  title="Unfavorite"
                  aria-label="Unfavorite"
                >
                  {pendingIds.includes(ep.episodeId) ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4 text-gray-600">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1" fill="none" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                      <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                    </svg>
                  )}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
