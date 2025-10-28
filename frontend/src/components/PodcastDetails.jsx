import React, { useEffect, useState } from 'react'
import apiFetch from '../lib/api'
import EpisodesList from './EpisodesList'

export default function PodcastDetails({ podcastId, onBack }) {
  const [podcast, setPodcast] = useState(null)
  const [imageUrl, setImageUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [latestEpisodeDate, setLatestEpisodeDate] = useState(null)
  const [tags, setTags] = useState([])
  const [totalEpisodes, setTotalEpisodes] = useState(null)

  useEffect(() => {
    if (!podcastId) return
    setLoading(true)
    setError(null)
    apiFetch(`/podcasts/${podcastId}`)
      .then((res) => {
        if (!res.ok) {
          // propagate 404 or other statuses
          throw new Error(res.status === 404 ? 'Not found' : 'Network error')
        }
        return res.json()
      })
      .then((data) => {
        // backend returns { podcast, items, trackCount }
        let p = null
        if (data && data.podcast) {
          p = data.podcast
        } else if (data && data.results) {
          // fallback to legacy iTunes shape
          p = data.results && data.results[0] ? data.results[0] : null
        }
        setPodcast(p)
        // initialize local image preview when podcast data arrives
        if (p) setImageUrl(p.image_url || p.artworkUrl600 || null)
        // try to extract genres/tags from the collection metadata
        if (p) {
          if (Array.isArray(p.genres) && p.genres.length) setTags(p.genres)
          else if (p.primaryGenreName) setTags([p.primaryGenreName])
          else if (typeof p.genre === 'string' && p.genre.length) setTags(p.genre.split(',').map(s => s.trim()))
          else setTags([])
        } else {
          setTags([])
        }
      })
      .catch((err) => setError(err.message || 'Failed to fetch'))
      .finally(() => setLoading(false))
  }, [podcastId])

  useEffect(() => {
    if (!podcastId) return
    let cancelled = false
    apiFetch(`/podcasts/${podcastId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Network error')
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        // backend returns items array; legacy iTunes returns results with wrapperType
        let items = []
        if (data && Array.isArray(data.items)) {
          items = data.items
        } else if (data && Array.isArray(data.results)) {
          items = (data.results || []).filter((it) => it.wrapperType === 'podcastEpisode' && it.releaseDate)
        }

        if (items.length === 0) {
          setLatestEpisodeDate(null)
          setTotalEpisodes(0)
          return
        }

        const latest = items.reduce((best, it) => {
          // try different date fields that may exist depending on source
          let d = null
          if (it.releaseDate) d = new Date(it.releaseDate)
          else if (it.publish_date) {
            // backend stores publish_date as seconds since epoch
            const maybeNum = Number(it.publish_date)
            if (!Number.isNaN(maybeNum)) d = new Date(maybeNum * 1000)
          } else if (it.publishDate) d = new Date(it.publishDate)
          return !best || d > best ? d : best
        }, null)

        setLatestEpisodeDate(latest ? latest.toISOString() : null)
        setTotalEpisodes(items.length)
      })
      .catch(() => {
        if (!cancelled) setLatestEpisodeDate(null)
      })

    return () => { cancelled = true }
  }, [podcastId])

  function formatDatePT(dateInput) {
    try {
      const d = new Date(dateInput)
      return d.toLocaleDateString('pt-PT', { year: 'numeric', month: 'long', day: 'numeric' })
    } catch {
      return ''
    }
  }

  if (!podcastId) return null

  return (
    <div className="max-w-4xl mx-auto p-4">
      <button className="mb-4 text-sm text-blue-600" onClick={onBack}>← Back</button>
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {podcast && (
        <>
          <article>
            {/* top area: image + add-control on the left, content on the right */}
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="md:w-full flex items-start gap-3">
                {/* artwork preview */}
                {imageUrl ? (
                  <img src={imageUrl} alt={podcast.title} className="w-40 h-40 md:max-w-[220px] md:h-auto object-cover rounded shadow flex-shrink-0" />
                ) : (
                  <div className="w-40 h-40 md:max-w-[220px] flex items-center justify-center bg-gray-100 text-gray-500 rounded">No image</div>
                )}

                {/* small control to the right of image */}
                <div className="flex flex-col justify-center text-sm">
                  <h2 className="text-2xl font-bold mb-2">{podcast.title}</h2>
                  <div className="text-sm text-gray-600 mb-2">By {podcast.artist}</div>

                  {tags && tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {tags.map((t, i) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-800 px-2 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                  )}

                  {typeof totalEpisodes === 'number' && (
                    <div className="text-sm text-gray-600">{totalEpisodes} episodes
                      {latestEpisodeDate && (
                        <>, latest on {formatDatePT(latestEpisodeDate)}</>
                      )}
                    </div>
                  )}
                  <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: podcast.description || '' }} />
                </div>
              </div>
            </div>
          </article>

          {/* full-width play row */}
          <div className="mt-6">
            <button className="w-full px-3 py-3 bg-blue-600 text-white rounded" onClick={() => (window.location.hash = `#/player/${podcastId}`)}>Play all episodes</button>
          </div>
        </>
      )}
      {podcast && <EpisodesList podcastId={podcastId} />}
      {!podcast && !loading && !error && <div className="text-sm text-gray-500">No details available.</div>}
    </div>
  )
}

