import React, { useMemo, useState } from 'react'
import apiFetch from '../lib/api'

export default function SavedPodcasts({ saved = [], onToggle = () => {}, onSuspend = () => {}, onResume = () => {} }) {
  const [sortBy, setSortBy] = useState('addedDate')
  const [desc, setDesc] = useState(true)
  const [viewMode, setViewMode] = useState('list')
  const [pendingIds, setPendingIds] = useState(new Set())

  function setPending(id, val) {
    setPendingIds((prev) => {
      const copy = new Set(prev)
      if (val) copy.add(id)
      else copy.delete(id)
      return copy
    })
  }

  async function handleSuspend(podcast) {
    const id = podcast?.podcastId
    if (!id) return
    // optimistic update
    const prev = podcast.suspended
    try {
      // reflect immediately
      podcast.suspended = 1
      setPending(id, true)
      const res = await apiFetch(`/podcasts/${id}/suspend`, { method: 'PATCH' })
      if (!res.ok) throw new Error(`Server ${res.status}`)
      // notify parent
      try { onSuspend(podcast) } catch (e) { console.error('parent onSuspend failed', e) }
    } catch (e) {
      podcast.suspended = prev
      console.error('Suspend failed', e)
      alert('Failed to suspend podcast')
    } finally {
      setPending(id, false)
    }
  }

  async function handleResume(podcast) {
    const id = podcast?.podcastId
    if (!id) return
    const prev = podcast.suspended
    try {
      podcast.suspended = 0
      setPending(id, true)
      const res = await apiFetch(`/podcasts/${id}/continue`, { method: 'PATCH' })
      if (!res.ok) throw new Error(`Server ${res.status}`)
      try { onResume(podcast) } catch (e) { console.error('parent onResume failed', e) }
    } catch (e) {
      podcast.suspended = prev
      console.error('Resume failed', e)
      alert('Failed to resume podcast')
    } finally {
      setPending(id, false)
    }
  }

  function parseDate(item, keys) {
    for (const k of keys) {
      if (!item) continue
      const v = item[k]
      if (!v) continue
      const d = new Date(v)
      if (!isNaN(d)) return d
    }
    return null
  }

  const sorted = useMemo(() => {
    const list = [...saved]
    list.sort((a, b) => {
      if (sortBy === 'name') {
        return a.collectionName?.localeCompare(b.collectionName || '') || 0
      }
      if (sortBy === 'totalEpisodes') {
        const na = Number(a.totalEpisodes || 0)
        const nb = Number(b.totalEpisodes || 0)
        return na - nb
      }
      if (sortBy === 'addedDate') {
        const da = parseDate(a, ['addedAt', 'addedDate', 'added', 'savedAt'])
        const db = parseDate(b, ['addedAt', 'addedDate', 'added', 'savedAt'])
        return (da ? da.getTime() : 0) - (db ? db.getTime() : 0)
      }
      if (sortBy === 'latestEpisode') {
        const da = parseDate(a, ['latestEpisodeDate', 'latest', 'lastEpisodeDate'])
        const db = parseDate(b, ['latestEpisodeDate', 'latest', 'lastEpisodeDate'])
        return (da ? da.getTime() : 0) - (db ? db.getTime() : 0)
      }
      return 0
    })
    if (desc) list.reverse()
    return list
  }, [saved, sortBy, desc])
  if (!saved || saved.length === 0) return null

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-medium">Saved podcasts</h3>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Order by</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="name">Name</option>
            <option value="totalEpisodes">Total # episodes</option>
            <option value="addedDate">Date added</option>
            <option value="latestEpisode">Lastest episosde</option>
          </select>
          <button onClick={() => setDesc((d) => !d)} className="px-2 py-1 border rounded text-sm">{desc ? 'Desc' : 'Asc'}</button>
          <div className="ml-2">
            <button onClick={() => setViewMode('list')} className={`px-2 py-1 border rounded text-sm mr-1 ${viewMode === 'list' ? 'bg-gray-200' : ''}`}>List</button>
            <button onClick={() => setViewMode('grid')} className={`px-2 py-1 border rounded text-sm ${viewMode === 'grid' ? 'bg-gray-200' : ''}`}>Grid</button>
          </div>
        </div>
      </div>

      {viewMode === 'list' ? (
        <ul className="space-y-2">
          {sorted.map((s) => (
            <li key={s.podcastId} className="flex items-center gap-3 p-2 border rounded">
              <img src={s.artworkUrl60} alt="art" width={48} height={48} className="rounded" />
              <div>
                <div className="font-medium"><a href={`#/podcast/${s.podcastId}`} className="text-blue-600 hover:underline">{s.collectionName}</a></div>
                <div className="text-sm text-gray-600">{s.artistName}</div>
                {s.genres && s.genres.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.genres.slice(0, 3).map((g) => (
                      <span key={g} className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{g}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {!s.suspended ? (
                  <button className="px-2 py-1 bg-yellow-300 text-yellow-900 rounded text-sm w-20" onClick={() => handleSuspend(s)} disabled={pendingIds.has(s.podcastId)}>Suspend</button>
                ) : (
                  <button className="px-2 py-1 bg-green-500 text-white rounded text-sm w-20" onClick={() => handleResume(s)} disabled={pendingIds.has(s.podcastId)}>Resume</button>
                )}
                <button className="px-2 py-1 bg-red-600 text-white rounded text-sm" onClick={() => onToggle(s)}>Remove</button>
              </div>
            </li>
            ))}
        </ul>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {sorted.map((s) => (
            <div key={s.podcastId} className="border rounded p-3 flex flex-col">
              <img src={s.artworkUrl600 || s.artworkUrl100} alt={s.collectionName} className="w-full h-40 object-cover rounded mb-2" />
              <div className="flex-1">
                <div className="font-medium text-sm mb-1"><a href={`#/podcast/${s.podcastId}`} className="text-blue-600 hover:underline">{s.collectionName}</a></div>
                <div className="text-xs text-gray-600 mb-2">{s.artistName}</div>
                {s.genres && s.genres.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.genres.slice(0, 3).map((g) => (
                      <span key={g} className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded">{g}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="text-xs text-gray-600">{typeof s.totalEpisodes === 'number' ? `${s.totalEpisodes} eps` : ''}</div>
                <div className="flex items-center gap-2">
                  {!s.suspended ? (
                    <button className="px-2 py-1 bg-yellow-300 text-yellow-900 rounded text-sm w-20" onClick={() => handleSuspend(s)} disabled={pendingIds.has(s.podcastId)}>Suspend</button>
                  ) : (
                    <button className="px-2 py-1 bg-green-500 text-white rounded text-sm w-20" onClick={() => handleResume(s)} disabled={pendingIds.has(s.podcastId)}>Resume</button>
                  )}
                  <button className="px-2 py-1 bg-red-600 text-white rounded text-sm" onClick={() => onToggle(s)}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
