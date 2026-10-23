import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Camera,
  Captions,
  Mic,
  MicOff,
  MonitorUp,
  Radio,
  RadioTower,
  ScreenShare,
  Signal,
  Square,
  Video,
} from 'lucide-react'
import { drawProgram, OUTPUT_HEIGHT, OUTPUT_WIDTH, type ProgramScene, type Source, type Transition } from './studio/programCompositor'
import { useSwitcherOutput } from './studio/useSwitcherOutput'

const initialSources: Source[] = [
  { id: 'bars', name: 'COLOR BARS', kind: 'pattern' },
  { id: 'camera-1', name: 'CAMERA 01', kind: 'camera' },
  { id: 'screen-1', name: 'SCREEN SHARE', kind: 'screen' },
  { id: 'feed-2', name: 'INPUT 04', kind: 'media' },
]

const OUTPUT_LABELS = { idle: 'OUTPUT OFF', connecting: 'CONNECTING', streaming: 'SENDING TO ORIGIN', error: 'OUTPUT ERROR' }

function PreviewMonitor({ source }: { source: Source }) {
  const videoRef = useRef<HTMLVideoElement>(null)

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
        {source.stream ? (
          <video ref={videoRef} autoPlay muted playsInline aria-label={`${source.name} source`} />
        ) : (
          <div className={`test-pattern ${source.kind}`} />
        )}
        <span className="screen-caption">{source.name}</span>
      </div>
      <p className="monitor-source">SOURCE: {source.name}</p>
    </section>
  )
}

function StudioPage() {
  const [sources, setSources] = useState(initialSources)
  const [previewId, setPreviewId] = useState('bars')
  const [programId, setProgramId] = useState('bars')
  const [transition, setTransition] = useState('CUT')
  const [duration, setDuration] = useState(350)
  const [isBlack, setIsBlack] = useState(false)
  const [lowerTitle, setLowerTitle] = useState('LIVE FROM GGTV')
  const [lowerDetail, setLowerDetail] = useState('Broadcast control room')
  const [ticker, setTicker] = useState('WELCOME TO GGTV LIVE')
  const [lowerOnAir, setLowerOnAir] = useState(false)
  const [tickerOnAir, setTickerOnAir] = useState(false)
  const [message, setMessage] = useState('Load a source to preview, then TAKE it to program.')
  const streams = useRef<MediaStream[]>([])
  const videos = useRef(new Map<string, HTMLVideoElement>())
  const programCanvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<ProgramScene | null>(null)
  const activeTransition = useRef<Transition | null>(null)
  const output = useSwitcherOutput(programCanvas)
  const previewSource = sources.find((source) => source.id === previewId) ?? sources[0]
  const programSource = sources.find((source) => source.id === programId) ?? sources[0]

  useEffect(() => {
    scene.current = {
      source: programSource,
      lowerThird: lowerOnAir ? { title: lowerTitle, detail: lowerDetail } : null,
      ticker: tickerOnAir ? ticker : '',
      black: isBlack,
    }
  })

  useEffect(() => {
    const context = programCanvas.current?.getContext('2d')
    if (!context) return
    // A timer rather than requestAnimationFrame, which stops entirely in background tabs.
    const timer = window.setInterval(() => {
      if (scene.current) drawProgram(context, scene.current, activeTransition.current, videos.current, performance.now())
    }, 1000 / 30)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => () => {
    streams.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()))
    videos.current.forEach((video) => { video.srcObject = null })
  }, [])

  async function addCapture(kind: 'camera' | 'screen') {
    try {
      const stream = kind === 'camera'
        ? await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const source: Source = {
        id: `${kind}-${Date.now()}`,
        name: kind === 'camera' ? 'CAMERA CAPTURE' : 'DESKTOP CAPTURE',
        kind,
        stream,
      }
      // The program canvas draws from its own muted video element for each captured source.
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      void video.play().catch(() => undefined)
      videos.current.set(source.id, video)
      streams.current.push(stream)
      setSources((current) => [...current, source])
      setPreviewId(source.id)
      setMessage(`${source.name} added to preview.`)
    } catch {
      setMessage(`${kind === 'camera' ? 'Camera' : 'Screen capture'} was cancelled or unavailable.`)
    }
  }

  function takeProgram() {
    if (previewId === programId) return
    activeTransition.current = transition === 'CUT' || duration === 0
      ? null
      : { from: programSource, mode: transition, start: performance.now(), duration }
    setProgramId(previewId)
    setIsBlack(false)
    setMessage(`${transition} to ${previewSource.name}.`)
  }

  return (
    <main className="studio-page">
      <header className="studio-heading">
        <div>
          <div className="eyebrow"><Radio size={13} /> GGTV STUDIO <span>/</span> SWITCHER</div>
          <h1>Studio switcher</h1>
        </div>
        <div className={`studio-mode output-${output.state}`}><span className="status-light" /> {OUTPUT_LABELS[output.state]}</div>
      </header>

      <section className="control-panel output-panel" aria-label="Program output">
        <div className="output-copy">
          <h2>Program output</h2>
          <p className={output.state === 'error' ? 'output-message error' : 'output-message'} role="status">
            {output.message || 'Send the PROGRAM monitor to viewers instead of using OBS. Keep this tab open and in front while sending.'}
          </p>
        </div>
        <div className="output-actions">
          <button className={output.micOn ? 'capture-button active' : 'capture-button'} type="button" onClick={() => void output.toggleMic()} aria-pressed={output.micOn}>
            {output.micOn ? <Mic size={14} /> : <MicOff size={14} />} {output.micOn ? 'MIC ON' : 'MIC OFF'}
          </button>
          {output.state === 'streaming' || output.state === 'connecting' ? (
            <button className="button button-danger" type="button" onClick={output.stop}><Square size={13} /> STOP OUTPUT</button>
          ) : (
            <button className="button button-primary" type="button" onClick={() => void output.start()}><RadioTower size={14} /> START OUTPUT</button>
          )}
          {output.state === 'streaming' && <Link className="text-link" to="/studio/live">GO LIVE PAGE ↗</Link>}
        </div>
      </section>

      <div className="studio-notice"><AlertTriangle size={15} /><span>PROGRAM shows exactly what is sent. Browsers slow down background tabs, so keep this tab visible while the output is on.</span></div>

      <div className="monitor-grid">
        <PreviewMonitor source={previewSource} />
        <section className="monitor-panel program">
          <div className="monitor-header"><span>PROGRAM</span><small>PGM 01 · {OUTPUT_WIDTH}×{OUTPUT_HEIGHT}</small></div>
          <div className="monitor-screen">
            <canvas ref={programCanvas} width={OUTPUT_WIDTH} height={OUTPUT_HEIGHT} aria-label={`Program output: ${programSource.name}`} />
          </div>
          <p className="monitor-source">SOURCE: {programSource.name}{isBlack ? ' · BLACK' : ''}</p>
        </section>
      </div>

      <section className="switcher-bar" aria-label="Transition controls">
        <div className="transition-options" role="group" aria-label="Transition type">
          {['CUT', 'FADE', 'MERGE', 'WIPE'].map((mode) => (
            <button
              className={transition === mode ? 'transition-option selected' : 'transition-option'}
              key={mode}
              type="button"
              aria-pressed={transition === mode}
              onClick={() => setTransition(mode)}
            >{mode}</button>
          ))}
        </div>
        <label className="duration-control">DURATION
          <input type="range" min="0" max="2000" step="50" value={duration} onChange={(event) => setDuration(Number(event.target.value))} />
          <span className="duration-value">{duration} ms</span>
        </label>
        <button className="take-button" type="button" onClick={takeProgram}>TAKE <span>↗</span></button>
        <button className={isBlack ? 'ftb-button active' : 'ftb-button'} type="button" onClick={() => setIsBlack((current) => !current)}>
          <Square size={13} /> FTB
        </button>
      </section>

      <div className="studio-lower-grid">
        <section className="control-panel">
          <div className="control-panel-heading"><h2>Input bank</h2><span>{sources.length.toString().padStart(2, '0')} SOURCES</span></div>
          <div className="input-bank">
            {sources.map((source, index) => (
              <button
                className={previewId === source.id ? 'input-tile previewing' : 'input-tile'}
                key={source.id}
                type="button"
                onClick={() => { setPreviewId(source.id); setMessage(`${source.name} loaded to preview.`) }}
                aria-pressed={previewId === source.id}
              >
                <span className={`input-art ${source.kind}`}>
                  {source.kind === 'camera' ? <Camera size={20} /> : source.kind === 'screen' ? <MonitorUp size={20} /> : source.kind === 'media' ? <Video size={20} /> : <Signal size={20} />}
                </span>
                <span className="input-label">{String(index + 1).padStart(2, '0')} · {source.name}</span>
              </button>
            ))}
          </div>
          <div className="capture-actions">
            <button className="capture-button" type="button" onClick={() => void addCapture('camera')}><Camera size={14} /> ADD CAMERA</button>
            <button className="capture-button" type="button" onClick={() => void addCapture('screen')}><ScreenShare size={14} /> SHARE SCREEN</button>
          </div>
          <p className="studio-message" role="status">{message}</p>
        </section>

        <section className="control-panel">
          <div className="control-panel-heading"><h2>On-air graphics</h2><span>LOWER THIRD · TICKER</span></div>
          <div className="graphics-form">
            <label className="field-label">Headline
              <input className="text-input" value={lowerTitle} onChange={(event) => setLowerTitle(event.target.value)} maxLength={48} />
            </label>
            <label className="field-label">Subheading
              <input className="text-input" value={lowerDetail} onChange={(event) => setLowerDetail(event.target.value)} maxLength={72} />
            </label>
            <label className="field-label">Ticker message
              <input className="text-input" value={ticker} onChange={(event) => setTicker(event.target.value)} maxLength={100} />
            </label>
            <div className="graphics-actions">
              <button className={lowerOnAir ? 'button button-danger' : 'button button-dark'} type="button" onClick={() => setLowerOnAir((current) => !current)}>
                <Captions size={14} /> {lowerOnAir ? 'TAKE LOWER OFF' : 'TAKE LOWER'}
              </button>
              <button className={tickerOnAir ? 'button button-danger' : 'button button-muted'} type="button" onClick={() => setTickerOnAir((current) => !current)}>
                <Signal size={14} /> {tickerOnAir ? 'TAKE TICKER OFF' : 'TAKE TICKER'}
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer className="studio-footer"><span><Signal size={12} /> PVW {previewSource.name}</span><span>PGM {programSource.name} {isBlack ? '· BLACK' : ''}</span></footer>
    </main>
  )
}

export default StudioPage
