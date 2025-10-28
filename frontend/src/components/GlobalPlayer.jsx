import React from 'react'
import useAudioPlayer from './useAudioPlayer'

export default function GlobalPlayer() {
  function formatTime(t) {
    if (t == null) return '--:--'
    const sec = Math.floor(t)
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const { playingId, currentTrack, play, stop, currentTime, duration, seek } = useAudioPlayer()

  if (!currentTrack) return null

  return (
    <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-white border rounded shadow-lg px-4 py-3 w-11/12 max-w-4xl z-40">
      {/* Top row: title/artist */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 pr-4">
          <div className="font-medium  whitespace-normal break-words">{currentTrack.title || currentTrack.id}</div>
        </div>
      </div>

      {/* Second row: seek + controls */}
      <div className="mt-3 flex items-center gap-4">
        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={currentTime || 0}
            onChange={(e) => seek(Number(e.target.value))}
            className="w-full h-1 bg-gray-200 rounded appearance-none"
          />
          <div className="flex justify-between text-xs text-gray-600 mt-1">
            <div>{formatTime(currentTime)}</div>
            <div>{formatTime(duration)}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="p-2 bg-blue-600 text-white rounded flex items-center justify-center hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 transition"
            onClick={() => play(currentTrack.id, currentTrack.url, currentTrack)}
            aria-label={playingId === currentTrack.id ? 'Pause' : 'Play'}
          >
            {playingId === currentTrack.id ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4">
                <path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4">
                <path fill="currentColor" d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button
            className="p-2 bg-gray-200 rounded flex items-center justify-center hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 transition"
            onClick={() => stop()}
            aria-label="Stop"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4 text-gray-700">
              <rect width="12" height="12" x="6" y="6" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
