import React, { useEffect, useState } from 'react'
import PodcastSearch from './components/PodcastSearch'
import PodcastDetails from './components/PodcastDetails'
import PodcastPlayer from './components/PodcastPlayer'
import Favorites from './components/Favorites'
import './index.css'
import apiFetch from './lib/api'
import { AudioPlayerProvider } from './components/AudioPlayer'
import GlobalPlayer from './components/GlobalPlayer'

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return hash
}

function App() {
  const hash = useHashRoute()

  // route: #/podcast/:id
  const match = hash.match(/^#\/podcast\/(\d+)/)
  const podcastId = match ? match[1] : null
  const playerMatch = hash.match(/^#\/player\/(\d+)/)
  const playerPodcastId = playerMatch ? playerMatch[1] : null

  function downloadFile(filename, content, mime = 'text/xml') {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // OPML generation from saved podcasts (fetched from backend)
  async function downloadOPML() {
    try {
      const res = await apiFetch('/podcasts')
      if (!res.ok) throw new Error('Failed to fetch saved podcasts')
      const data = await res.json()
      const list = Array.isArray(data) ? data.map((p) => ({
        collectionId: p.itunes_id,
        collectionName: p.title,
        feedUrl: p.rss_url || p.feedUrl || p.feed,
        collectionViewUrl: p.collectionViewUrl || '',
      })) : []
      const now = new Date().toISOString()
      const outlines = list.map((p) => `  <outline text="${escapeXml(p.collectionName)}" title="${escapeXml(p.collectionName)}" type="rss" xmlUrl="${escapeXml(p.feedUrl || p.rssFeed || p.feed)}" htmlUrl="${escapeXml(p.collectionViewUrl || '')}"/>`).join('\n')
      const opml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n<head><title>Exported podcasts</title><dateCreated>${now}</dateCreated></head>\n<body>\n${outlines}\n</body>\n</opml>`
      downloadFile('podcasts.opml', opml, 'text/x-opml')
    } catch (e) {
      console.error('Failed to export OPML', e)
      alert('Failed to export OPML')
    }
  }

  function escapeXml(s) {
    if (!s) return ''
    return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c])
  }

  // Download RSS for the currently selected podcast (if available in saved list)
  async function downloadCurrentRSS() {
    if (!podcastId) return alert('Open a podcast details page first')
    try {
      const res = await apiFetch('/podcasts')
      if (!res.ok) throw new Error('Failed to fetch saved podcasts')
      const data = await res.json()
      const list = Array.isArray(data) ? data.map((p) => ({
        podcastId: p.id,
        collectionName: p.title,
        feedUrl: p.rss_url
      })) : []
      const p = list.find((x) => String(x.podcastId) === String(podcastId))
      const feed = p?.feedUrl || null
      if (!feed) return alert('No RSS/feed URL available for this podcast')
      fetch(feed).then((res) => {
        if (!res.ok) throw new Error('Failed to fetch feed')
        return res.text()
      }).then((text) => downloadFile(`${p.collectionName || 'podcast'}.xml`, text, 'text/xml')).catch((err) => {
        console.error(err)
        alert('Failed to download feed content; copying the feed URL to clipboard instead')
        navigator.clipboard?.writeText(feed)
      })
    } catch (e) {
      console.error(e)
      alert('Failed to download RSS')
    }
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white shadow-sm py-4">
        <div className="max-w-4xl mx-auto px-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <a href="#/" aria-label="Home" className="text-inherit no-underline hover:underline flex items-center gap-2">
              <img src="/static/electrocardiogram.png" alt="logo" className="w-6 h-6 inline-block" />
              <span>PodPulse</span>
            </a>
          </h1>
          <div className="flex items-center gap-3">
            <button className="px-3 py-1 border rounded text-sm" onClick={() => (window.location.hash = '#/favorites')}>Favorites</button>
            <button className="px-3 py-1 border rounded text-sm" onClick={downloadOPML}>Download OPML</button>
            <button className="px-3 py-1 border rounded text-sm" onClick={downloadCurrentRSS}>Download RSS</button>
          </div>
        </div>
      </header>

      <main className="py-8">
        <AudioPlayerProvider>
          {hash === '#/favorites' ? (
            <Favorites />
          ) : playerPodcastId ? (
            <PodcastPlayer podcastId={playerPodcastId} />
          ) : podcastId ? (
            <PodcastDetails podcastId={podcastId} onBack={() => (window.location.hash = '')} />
          ) : (
            <PodcastSearch />
          )}
          {/* Hide the GlobalPlayer on the dedicated player route */}
          {!playerPodcastId && <GlobalPlayer />}
        </AudioPlayerProvider>
      </main>
    </div>
  )
}

export default App
