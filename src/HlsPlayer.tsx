import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { Radio, Signal } from 'lucide-react'

type HlsPlayerProps = {
  src: string
  channelName: string
}

function HlsPlayer({ src, channelName }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [failedSrc, setFailedSrc] = useState('')
  const [playingSrc, setPlayingSrc] = useState('')

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
  }, [src])

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

  return (
    <div className="player-frame">
      <video
        ref={videoRef}
        className="hls-video"
        controls
        playsInline
        preload="none"
        aria-label={`${channelName} live video`}
        onPlaying={() => setPlayingSrc(src)}
        onWaiting={() => setPlayingSrc((current) => current === src ? '' : current)}
        onError={() => setFailedSrc(src)}
      />
      <div className="player-corner"><span className="live-dot" /> GGTV / LIVE</div>
      {status !== 'playing' && (
        <div className="player-state">
          {status === 'offline' ? <Signal size={28} /> : <Radio size={28} />}
          <strong>{statusText}</strong>
          <span>{src || 'No HLS source is configured for this channel.'}</span>
        </div>
      )}
    </div>
  )
}

export default HlsPlayer