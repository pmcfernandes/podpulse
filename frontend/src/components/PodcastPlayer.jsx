import React, { useEffect, useState } from 'react'
import apiFetch from '../lib/api'
import useAudioPlayer from './useAudioPlayer'

export default function PodcastPlayer({ podcastId }) {
  const [podcast, setPodcast] = useState(null)
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const { play, playingId, currentTime, duration, seek } = useAudioPlayer()
  const [showFullDescription, setShowFullDescription] = useState(false)

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
        // backend returns { podcast, items, trackCount }
        let collection = null
        let eps = []
        if (data && data.podcast) {
          collection = data.podcast
          eps = Array.isArray(data.items) ? data.items : []
        } else if (data && Array.isArray(data.results)) {
          // fallback to legacy iTunes response shape
          const items = data.results || []
          collection = items.find((it) => it.wrapperType === 'collection') || items[0]
          eps = items.filter((it) => it.wrapperType === 'podcastEpisode')
        }

        // normalize backend items to expected frontend fields
        const normalized = eps.map((it) => {
          const releaseDate = it.releaseDate || it.publishDate || (it.publish_date ? new Date(Number(it.publish_date) * 1000).toISOString() : null)
          return {
            episodeId: it.id,
            trackId: it.track_id,
            trackName: it.title,
            artistName: it.author || '',
            description: it.desc || '',
            releaseDate,
            episodeUrl: (it.downloaded ? `/api/episodes/${it.id}/download` : it.media_url),
            artworkUrl100: it.image_url,
            trackTimeMillis: it.trackTimeMillis || undefined,
            // keep original in case other fields are used
            __raw: it,
          }
        })

        setPodcast(collection || null)
        setEpisodes(normalized)
      })
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [podcastId])

  function getAudioUrl(ep) {
    return ep?.episodeUrl || null
  }

  function formatDatePT(dateStr) {
    if (!dateStr) return ''
    try {
      return new Date(dateStr).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })
    } catch {
      return dateStr
    }
  }

  function stripHtmlAndTruncate(html = '', max = 300) {
    // basic HTML strip
    const tmp = html.replace(/<[^>]+>/g, '')
    if (tmp.length <= max) return tmp
    return tmp.slice(0, max).trim() + '…'
  }

  function stripHtml(html = '') {
    return String(html).replace(/<[^>]+>/g, '')
  }

  function formatTime(sec) {
    if (sec == null || !isFinite(sec)) return '--:--'
    const s = Math.max(0, Math.floor(sec))
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${String(r).padStart(2, '0')}`
  }

  // when selected changes, instruct global player to play the selected episode
  useEffect(() => {
    if (!selected) return
    const url = getAudioUrl(selected)
    if (!url) return
    const meta = {
      title: selected.trackName,
      artist: selected.artistName,
      duration: selected.trackTimeMillis ? Math.round(selected.trackTimeMillis / 1000) : undefined,
    }
    play(selected.trackId, url, meta)
    setShowFullDescription(false)
  }, [selected, play])

  if (!podcastId) return null

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="flex gap-6">
        <aside className="w-1/3">
          <div className="sticky top-6">
            {podcast && (
              <div className="mb-4">
                <img src={podcast.image_url} className="w-full h-auto object-cover rounded mb-3" />
                <h2 className="text-xl font-semibold">{podcast.title}</h2>
                <div className="text-sm text-gray-600 mb-2">{podcast.artist}</div>
              </div>
            )}

            {selected && (
              <div className="mt-4 border rounded p-3 bg-gray-50">
                <div className="font-semibold">{selected.trackName}</div>
                <div className="text-sm text-gray-600 mb-2">{formatDatePT(selected.releaseDate)}</div>
                <div className="text-sm text-gray-700 mb-2">
                  {showFullDescription ? (
                    <div>{stripHtml(selected.description || '')}</div>
                  ) : (
                    <div>{stripHtmlAndTruncate(selected.description || '')}</div>
                  )}
                  {stripHtml(selected.description || '').length > 300 && (
                    <button className="text-sm text-blue-600 mt-2" onClick={() => setShowFullDescription((s) => !s)}>
                      {showFullDescription ? 'Show less' : 'Read more'}
                    </button>
                  )}
                </div>

                <div className="mt-3">
                  <div className="flex items-center gap-3">
                    <button
                      className={`h-9 w-9 rounded flex items-center justify-center ${playingId === selected.trackId ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}
                      onClick={() => {
                        // toggle play/pause via global player
                        play(selected.trackId, getAudioUrl(selected), { title: selected.trackName })
                      }}
                      aria-label={playingId === selected.trackId ? `Pause ${selected.trackName}` : `Play ${selected.trackName}`}
                    >
                      {playingId === selected.trackId ? (
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

                    <div className="flex-1">
                      <input
                        type="range"
                        min={0}
                        max={duration || 0}
                        value={Math.min(currentTime || 0, duration || 0)}
                        onChange={(e) => seek(Number(e.target.value))}
                        className="w-full"
                        aria-label="Seek"
                      />
                      <div className="text-xs text-gray-500 mt-1">{formatTime(currentTime)} / {duration ? formatTime(duration) : '--:--'}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className="flex-1">
          <h3 className="text-lg font-medium mb-3">Episodes</h3>
          {loading && <div className="text-sm text-gray-500">Loading episodes…</div>}
          {error && <div className="text-sm text-red-600">Error: {error}</div>}
          <ul className="space-y-2">
            {episodes.map((ep) => {
              const audioUrl = getAudioUrl(ep)
              return (
                <li key={ep.trackId} className="flex items-start gap-3 p-2 border rounded">
                  <div className="flex-1">
                    <div className="font-medium">{ep.trackName}</div>
                    <div className="text-sm text-gray-600">{formatDatePT(ep.releaseDate)}</div>
                    <div className="text-sm text-gray-700 mt-1">{stripHtmlAndTruncate(ep.description)}</div>
                  </div>
                  <div className="flex flex-col items-start gap-2">
                    <button
                      className="h-9 w-9 rounded bg-blue-600 text-white flex items-center justify-center"
                      onClick={() => {
                        // ensure clicking the list play button starts playback immediately
                        const url = getAudioUrl(ep)
                        if (url) {
                          play(ep.trackId, url, { title: ep.trackName, artist: ep.artistName, duration: ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 1000) : undefined })
                        }
                        setSelected(ep)
                      }}
                      disabled={!audioUrl}
                      aria-label={`Play ${ep.trackName}`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4">
                        <path d="M5 3v18l15-9L5 3z" fill="currentColor" />
                      </svg>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}
