import { useContext } from 'react'
import { AudioPlayerContext } from './AudioPlayerContext'

export default function useAudioPlayer() {
  const ctx = useContext(AudioPlayerContext)
  if (!ctx) throw new Error('useAudioPlayer must be used inside AudioPlayerProvider')
  return ctx
}
