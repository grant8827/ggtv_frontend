import Hls from 'hls.js'
import type { Playlist } from '../api'
import { getFile } from './mediaStore'

export type PlaylistPlayer = {
  video: HTMLVideoElement
  skip: () => void
  // Holds the current video where it is, so it can carry on from there later.
  pause: () => void
  resume: () => void
  destroy: () => void
}

// Plays a playlist's items back to back (looping) in one video element that the switcher
// draws from. Browser-stored files come from IndexedDB; links need CORS to be drawn and heard.
export function createPlaylistPlayer(playlist: Playlist, onStatus: (text: string, isError?: boolean) => void): PlaylistPlayer {
  const video = document.createElement('video')
  video.playsInline = true
  video.crossOrigin = 'anonymous'
  const items = playlist.items
  let index = -1
  let objectUrl = ''
  let hls: Hls | null = null
  let failuresInRow = 0
  let destroyed = false
  // Each attempt to play an item gets a number, so a failure is only handled once.
  let attempt = 0
  let paused = false

  function fail(forAttempt: number, title: string, reason: string) {
    if (destroyed || forAttempt !== attempt) return
    attempt += 1
    failuresInRow += 1
    onStatus(`Skipped "${title}" (${reason})`, true)
    void playNext()
  }

  function release() {
    hls?.destroy()
    hls = null
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }

  async function playNext() {
    if (destroyed) return
    if (failuresInRow >= items.length) {
      onStatus('None of this playlist\'s videos can play in this browser.', true)
      return
    }
    index = (index + 1) % items.length
    const item = items[index]
    const current = ++attempt
    release()
    try {
      if (item.mediaId) {
        video.src = `/api/studio/media/${item.mediaId}/file`
      } else if (item.fileId) {
        const stored = await getFile(item.fileId)
        if (!stored) throw new Error('not stored in this browser')
        objectUrl = URL.createObjectURL(stored.blob)
        video.src = objectUrl
      } else if (item.url && /\.m3u8(\?|$)/i.test(item.url) && !video.canPlayType('application/vnd.apple.mpegurl') && Hls.isSupported()) {
        hls = new Hls()
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) fail(current, item.title, 'the stream could not be loaded')
        })
        hls.loadSource(item.url)
        hls.attachMedia(video)
      } else if (item.url) {
        video.src = item.url
      } else {
        throw new Error('no video')
      }
      if (destroyed || current !== attempt) return
      if (paused) {
        onStatus(`Paused at ${index + 1}/${items.length}: ${item.title}`)
        return
      }
      await video.play()
      if (current !== attempt) return
      failuresInRow = 0
      onStatus(`Now playing ${index + 1}/${items.length}: ${item.title}`)
    } catch (error) {
      fail(current, item.title, error instanceof Error ? error.message : 'could not play')
    }
  }

  video.addEventListener('ended', () => void playNext())
  video.addEventListener('error', () => {
    const item = items[index]
    if (item) fail(attempt, item.title, 'the video could not be loaded')
  })

  if (items.length) void playNext()
  else onStatus('This playlist has no videos.', true)

  return {
    video,
    skip: () => void playNext(),
    pause() {
      if (paused) return
      paused = true
      video.pause()
      const item = items[index]
      if (item) onStatus(`Paused at ${index + 1}/${items.length}: ${item.title}`)
    },
    resume() {
      if (!paused || destroyed) return
      paused = false
      const item = items[index]
      video.play().then(() => item && onStatus(`Now playing ${index + 1}/${items.length}: ${item.title}`)).catch(() => undefined)
    },
    destroy() {
      destroyed = true
      video.pause()
      release()
      video.removeAttribute('src')
      video.load()
    },
  }
}
