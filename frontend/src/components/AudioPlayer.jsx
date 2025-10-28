import React, { useRef, useState, useCallback } from 'react'
import { AudioPlayerContext } from './AudioPlayerContext'

export function AudioPlayerProvider({ children }) {
  const audioRef = useRef(null)
  const [playingId, setPlayingId] = useState(null)
  const [currentTrack, setCurrentTrack] = useState(null)

  const play = useCallback((id, url, meta = {}) => {
    if (!url) return

    const isSameTrack = currentTrack && currentTrack.id === id

    // If same track and we have an audio element, toggle pause/resume
    if (isSameTrack && audioRef.current) {
      try {
        if (audioRef.current.paused) {
          audioRef.current.play().then(() => setPlayingId(id)).catch(() => {})
        } else {
          audioRef.current.pause()
          setPlayingId(null)
        }
      } catch {
        /* ignore play/pause errors */
      }
      return
    }

    // If same track but audio element missing, we'll recreate and play below

    // stop previous
    if (audioRef.current) {
      try { audioRef.current.pause() } catch { /* ignore pause errors */ }
      audioRef.current = null
    }

    const audio = new Audio(url)
    audioRef.current = audio
    // update metadata and progress
    audio.onloadedmetadata = () => {
      setDuration(isFinite(audio.duration) ? audio.duration : null)
    }
    audio.ontimeupdate = () => setCurrentTime(audio.currentTime)
    audio.play().then(() => setPlayingId(id)).catch(() => {})
    audio.onended = () => {
      setPlayingId(null)
      setCurrentTime(0)
    }
    setCurrentTrack({ id, url, ...meta })
  }, [currentTrack])

  const stop = useCallback(() => {
    if (audioRef.current) {
      try { audioRef.current.pause() } catch { /* ignore pause errors */ }
      audioRef.current = null
      setPlayingId(null)
      // clear current track so the global player UI can hide
      try { setCurrentTrack(null) } catch { /* ignore */ }
      try { setCurrentTime(0) } catch { /* ignore */ }
      try { setDuration(null) } catch { /* ignore */ }
    }
  }, [])

  // playback progress
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(null)

  const seek = useCallback((time) => {
    if (audioRef.current) {
      try { audioRef.current.currentTime = time } catch { /* ignore seek errors */ }
      setCurrentTime(time)
    }
  }, [])

  const value = {
    play,
    stop,
    playingId,
    currentTrack,
    currentTime,
    duration,
    seek,
  }

  return <AudioPlayerContext.Provider value={value}>{children}</AudioPlayerContext.Provider>
}

export default AudioPlayerProvider
