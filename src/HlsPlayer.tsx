import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { Radio, Signal } from 'lucide-react'

type HlsPlayerProps = {
  src: string
  channelName: string
  // A full-screen message (logo, title, detail) shown instead of the video, as on the apps.
  slate?: { title: string; detail: string }
  // Viewers also get the app screens while connecting, and OFF AIR when the stream fails; the studio
  // monitor keeps the technical status with the stream address.
  viewer?: boolean
}

const RETRY_MS = 5000

function HlsPlayer({ src, channelName, slate, viewer = false }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failedSrc, setFailedSrc] = useState('')
  const [playingSrc, setPlayingSrc] = useState('')
  // Bumped to reload the source; a stream that isn't up yet keeps being retried.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!src || failedSrc !== src) return
    const timer = window.setTimeout(() => {
      setFailedSrc('')
      setAttempt((current) => current + 1)
    }, RETRY_MS)
    return () => window.clearTimeout(timer)
  }, [failedSrc, src])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!src) return

    let player: Hls | undefined

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
    } else if (Hls.isSupported()) {
      player = new Hls({ backBufferLength: 30 })
      player.loadSource(src)
      player.attachMedia(video)
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setFailedSrc(src)
      })
    } else {
      video.src = src
    }

    return () => {
      player?.destroy()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [src, attempt])

  const status = !src || failedSrc === src
    ? 'offline'
    : playingSrc === src
      ? 'playing'
      : 'connecting'

  const statusText = {
    connecting: 'CONNECTING TO ORIGIN',
    playing: 'LIVE PLAYBACK',
    offline: 'SIGNAL UNAVAILABLE',
  }[status]

  const screen = slate ?? (!viewer || status === 'playing'
    ? undefined
    : status === 'offline' ? { title: 'OFF AIR', detail: 'GGTV will be back soon.' } : { title: 'CONNECTING', detail: '' })

  return (
    <div className="player-frame">
      <video
        ref={videoRef}
        className="hls-video"
        controls={!screen}
        playsInline
        preload="metadata"
        // Live TV starts muted on its own (browsers allow that), including after a retry.
        autoPlay
        muted
        aria-label={`${channelName} live video`}
        onPlaying={() => setPlayingSrc(src)}
        onWaiting={() => setPlayingSrc((current) => current === src ? '' : current)}
        onError={() => setFailedSrc(src)}
      />
      {!screen && <div className="player-corner"><span className="live-dot" /> GGTV / LIVE</div>}
      {screen ? (
        <div className={`player-state player-slate${screen === slate || status === 'offline' ? '' : ' see-through'}`}>
          <img className="player-logo" src="/logo-dark.png" alt="GGTV" />
          <strong>{screen.title}</strong>
          {screen.detail && <p>{screen.detail}</p>}
        </div>
      ) : status !== 'playing' && (
        <div className="player-state">
          <img className="player-logo" src="/logo-dark.png" alt="GGTV" />
          {status === 'offline' ? <Signal size={28} /> : <Radio size={28} />}
          <strong>{statusText}</strong>
          <span>{src || 'No HLS source is configured for this channel.'}</span>
        </div>
      )}
    </div>
  )
}

export default HlsPlayer