import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  Captions,
  ListVideo,
  Mic,
  MicOff,
  MonitorUp,
  Radio,
  RadioTower,
  RefreshCw,
  ScreenShare,
  Signal,
  SkipForward,
  Square,
  Video,
  X,
} from 'lucide-react'
import { OUTPUT_HEIGHT, OUTPUT_WIDTH, type Source } from './studio/programCompositor'
import { useSwitcher } from './studio/switcherContext'

const OUTPUT_LABELS = { idle: 'OUTPUT OFF', connecting: 'CONNECTING', streaming: 'SENDING TO ORIGIN', error: 'OUTPUT ERROR' }

function PreviewMonitor({ source }: { source: Source }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Playlist sources play in an element owned by their player; mirror it onto a canvas.
  useEffect(() => {
    const element = source.element
    const context = canvasRef.current?.getContext('2d')
    if (!element || !context) return
    const timer = window.setInterval(() => {
      context.fillStyle = '#080d0b'
      context.fillRect(0, 0, 640, 360)
      if (element.readyState < 2 || !element.videoWidth) return
      const scale = Math.min(640 / element.videoWidth, 360 / element.videoHeight)
      const width = element.videoWidth * scale
      const height = element.videoHeight * scale
      context.drawImage(element, (640 - width) / 2, (360 - height) / 2, width, height)
    }, 1000 / 15)
    return () => window.clearInterval(timer)
  }, [source.element])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !source.stream) return
    video.srcObject = source.stream
    void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [source.stream])

  return (
    <section className="monitor-panel preview">
      <div className="monitor-header"><span>PREVIEW</span><small>PVW 01</small></div>
      <div className="monitor-screen">
        {source.element ? (
          <canvas ref={canvasRef} width={640} height={360} aria-label={`${source.name} source`} />
        ) : source.stream ? (
          <video ref={videoRef} autoPlay muted playsInline aria-label={`${source.name} source`} />
        ) : source.offline ? (
          <div className="offline-slate">{source.name} · OFFLINE</div>
        ) : (
          <div className={`test-pattern ${source.kind}`} />
        )}
        <span className="screen-caption">{source.name}</span>
      </div>
      <p className="monitor-source">SOURCE: {source.name}</p>
    </section>
  )
}

// Shows the studio-wide PROGRAM canvas; it keeps drawing (and sending) when this page is closed.
function ProgramMonitor() {
  const { programCanvas, programSource, isBlack } = useSwitcher()
  const slot = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = slot.current
    if (!container) return
    container.appendChild(programCanvas)
    return () => {
      programCanvas.remove()
    }
  }, [programCanvas])

  return (
    <section className="monitor-panel program">
      <div className="monitor-header"><span>PROGRAM</span><small>PGM 01 · {OUTPUT_WIDTH}×{OUTPUT_HEIGHT}</small></div>
      <div className="monitor-screen" ref={slot} />
      <p className="monitor-source">SOURCE: {programSource.name}{isBlack ? ' · BLACK' : ''}</p>
    </section>
  )
}

function StudioPage() {
  const switcher = useSwitcher()
  const { output, live, sources, previewSource, programSource } = switcher
  const [playlistId, setPlaylistId] = useState('')
  const loadedPlaylists = sources.filter((source) => source.saved?.kind === 'playlist' && !source.offline)
  const offlineCount = sources.filter((source) => source.offline).length
  const sending = output.state === 'streaming'

  return (
    <main className="studio-page">
      <header className="studio-heading">
        <div>
          <div className="eyebrow"><Radio size={13} /> GGTV STUDIO <span>/</span> GO LIVE</div>
          <h1>Go live</h1>
        </div>
        <div className="heading-badges">
          {live?.isLive && <div className="on-air-badge live"><span className="status-light" /> ON AIR</div>}
          <div className={`studio-mode output-${output.state}`}><span className="status-light" /> {OUTPUT_LABELS[output.state]}</div>
        </div>
      </header>

      <section className="control-panel output-panel" aria-label="Program output">
        <div className="output-copy">
          <h2>Program output</h2>
          <p className={output.state === 'error' ? 'output-message error' : 'output-message'} role="status">
            {output.message || '1. Start the output to send PROGRAM to the server. 2. Go live to show it on the home page. It keeps running while you use other studio pages.'}
          </p>
        </div>
        <div className="output-actions">
          <button className={output.micOn ? 'capture-button active' : 'capture-button'} type="button" onClick={() => void output.toggleMic()} aria-pressed={output.micOn}>
            {output.micOn ? <Mic size={14} /> : <MicOff size={14} />} {output.micOn ? 'MIC ON' : 'MIC OFF'}
          </button>
          {sending || output.state === 'connecting' ? (
            <button className="button button-muted" type="button" onClick={output.stop}><Square size={13} /> STOP OUTPUT</button>
          ) : (
            <button className="button button-dark" type="button" onClick={() => void output.start()}><RadioTower size={14} /> START OUTPUT</button>
          )}
          {live?.isLive ? (
            <button className="button button-danger" type="button" onClick={() => void switcher.endBroadcast()} disabled={switcher.liveBusy}><Square size={13} /> END BROADCAST</button>
          ) : (
            <button className="button button-primary" type="button" onClick={() => void switcher.goLive()} disabled={switcher.liveBusy || !live}><RadioTower size={14} /> GO LIVE</button>
          )}
        </div>
      </section>

      <div className="studio-notice"><AlertTriangle size={15} /><span>PROGRAM shows exactly what is sent. You can switch to other tabs and studio pages while sending; closing this tab or letting the computer sleep stops the output.</span></div>

      <div className="monitor-grid">
        <PreviewMonitor source={previewSource} />
        <ProgramMonitor />
      </div>

      <section className="switcher-bar" aria-label="Transition controls">
        <div className="transition-options" role="group" aria-label="Transition type">
          {['CUT', 'FADE', 'MERGE', 'WIPE'].map((mode) => (
            <button
              className={switcher.transition === mode ? 'transition-option selected' : 'transition-option'}
              key={mode}
              type="button"
              aria-pressed={switcher.transition === mode}
              onClick={() => switcher.setTransition(mode)}
            >{mode}</button>
          ))}
        </div>
        <label className="duration-control">DURATION
          <input type="range" min="0" max="2000" step="50" value={switcher.duration} onChange={(event) => switcher.setDuration(Number(event.target.value))} />
          <span className="duration-value">{switcher.duration} ms</span>
        </label>
        <button className="take-button" type="button" onClick={switcher.takeProgram}>TAKE <span>↗</span></button>
        <button className={switcher.isBlack ? 'ftb-button active' : 'ftb-button'} type="button" onClick={switcher.toggleBlack}>
          <Square size={13} /> FTB
        </button>
      </section>

      <div className="studio-lower-grid">
        <section className="control-panel">
          <div className="control-panel-heading"><h2>Input bank</h2><span>{sources.length.toString().padStart(2, '0')} SOURCES · SAVED IN THIS BROWSER</span></div>
          <div className="input-bank">
            {sources.map((source, index) => (
              <div key={source.id} className="input-tile-wrap">
                <button
                  className={[
                    'input-tile',
                    previewSource.id === source.id ? 'previewing' : '',
                    programSource.id === source.id ? 'on-program' : '',
                    source.offline ? 'offline' : '',
                  ].join(' ')}
                  type="button"
                  onClick={() => switcher.selectPreview(source)}
                  aria-pressed={previewSource.id === source.id}
                  title={source.offline ? 'Click to reconnect' : undefined}
                >
                  <span className={`input-art ${source.kind}`}>
                    {source.offline ? <RefreshCw size={18} /> : source.kind === 'camera' ? <Camera size={20} /> : source.kind === 'screen' ? <MonitorUp size={20} /> : source.kind === 'media' ? <Video size={20} /> : <Signal size={20} />}
                  </span>
                  <span className="input-label">{String(index + 1).padStart(2, '0')} · {source.name}{source.offline ? ' · RECONNECT' : ''}</span>
                </button>
                {source.id !== 'bars' && (
                  <button className="tile-remove" type="button" onClick={() => switcher.removeSource(source)} aria-label={`Remove ${source.name}`}><X size={11} /></button>
                )}
              </div>
            ))}
          </div>
          <div className="capture-actions">
            <button className="capture-button" type="button" onClick={() => void switcher.addCapture('camera')}><Camera size={14} /> ADD CAMERA</button>
            <button className="capture-button" type="button" onClick={() => void switcher.addCapture('screen')}><ScreenShare size={14} /> SHARE SCREEN</button>
            {offlineCount > 0 && (
              <button className="capture-button primary" type="button" onClick={() => void switcher.reconnectAll()}><RefreshCw size={14} /> RECONNECT {offlineCount} SAVED</button>
            )}
          </div>
          <div className="playlist-loader">
            <select className="text-input" aria-label="Playlist to load" value={playlistId} onChange={(event) => setPlaylistId(event.target.value)}>
              <option value="">{switcher.playlists.length ? 'Choose a playlist…' : 'No playlists yet'}</option>
              {switcher.playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name} ({playlist.items.length})</option>)}
            </select>
            <button className="capture-button" type="button" onClick={() => switcher.loadPlaylist(playlistId)} disabled={!playlistId}><ListVideo size={14} /> LOAD PLAYLIST</button>
          </div>
          {loadedPlaylists.length > 0 && (
            <ul className="loaded-playlists">
              {loadedPlaylists.map((source) => (
                <li key={source.id}>
                  <span className="loaded-name"><strong>{source.name}</strong><small className={switcher.playerStatus[source.id]?.isError ? 'error' : ''}>{switcher.playerStatus[source.id]?.text ?? 'Loading…'}</small></span>
                  <button className="dash-icon-button light" type="button" onClick={() => switcher.skip(source)} aria-label={`Skip to the next video in ${source.name}`}><SkipForward size={13} /></button>
                </li>
              ))}
            </ul>
          )}
          <p className="studio-message" role="status">{switcher.message}</p>
        </section>

        <section className="control-panel">
          <div className="control-panel-heading"><h2>On-air graphics</h2><span>LOWER THIRD · TICKER</span></div>
          <div className="graphics-form">
            <label className="field-label">Headline
              <input className="text-input" value={switcher.lowerTitle} onChange={(event) => switcher.setLowerTitle(event.target.value)} maxLength={48} />
            </label>
            <label className="field-label">Subheading
              <input className="text-input" value={switcher.lowerDetail} onChange={(event) => switcher.setLowerDetail(event.target.value)} maxLength={72} />
            </label>
            <label className="field-label">Ticker message
              <input className="text-input" value={switcher.ticker} onChange={(event) => switcher.setTicker(event.target.value)} maxLength={100} />
            </label>
            <div className="graphics-actions">
              <button className={switcher.lowerOnAir ? 'button button-danger' : 'button button-dark'} type="button" onClick={switcher.toggleLower}>
                <Captions size={14} /> {switcher.lowerOnAir ? 'TAKE LOWER OFF' : 'TAKE LOWER'}
              </button>
              <button className={switcher.tickerOnAir ? 'button button-danger' : 'button button-muted'} type="button" onClick={switcher.toggleTicker}>
                <Signal size={14} /> {switcher.tickerOnAir ? 'TAKE TICKER OFF' : 'TAKE TICKER'}
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer className="studio-footer"><span><Signal size={12} /> PVW {previewSource.name}</span><span>PGM {programSource.name} {switcher.isBlack ? '· BLACK' : ''}</span></footer>
    </main>
  )
}

export default StudioPage
