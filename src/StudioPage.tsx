import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  Captions,
  MonitorUp,
  Radio,
  ScreenShare,
  Signal,
  Square,
  Video,
} from 'lucide-react'

type Source = {
  id: string
  name: string
  kind: 'pattern' | 'camera' | 'screen' | 'media'
  stream?: MediaStream
}

const initialSources: Source[] = [
  { id: 'bars', name: 'COLOR BARS', kind: 'pattern' },
  { id: 'camera-1', name: 'CAMERA 01', kind: 'camera' },
  { id: 'screen-1', name: 'SCREEN SHARE', kind: 'screen' },
  { id: 'feed-2', name: 'INPUT 04', kind: 'media' },
]

function Monitor({
  source,
  label,
  isProgram,
  isBlack = false,
  lowerThird,
  ticker,
}: {
  source: Source
  label: string
  isProgram?: boolean
  isBlack?: boolean
  lowerThird: { title: string; detail: string } | null
  ticker: string
}) {
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
    <section className={isProgram ? 'monitor-panel program' : 'monitor-panel preview'}>
      <div className="monitor-header"><span>{label}</span><small>{isProgram ? 'PGM 01' : 'PVW 01'}</small></div>
      <div className="monitor-screen">
        {source.stream ? (
          <video ref={videoRef} autoPlay muted playsInline aria-label={`${source.name} source`} />
        ) : (
          <div className={`test-pattern ${source.kind}`} />
        )}
        <span className="screen-caption">{source.name}</span>
        {isProgram && lowerThird && (
          <div className="monitor-overlay-lower"><Captions size={16} /><div><strong>{lowerThird.title}</strong><span>{lowerThird.detail}</span></div></div>
        )}
        {isProgram && ticker && <div className="monitor-ticker">{ticker}</div>}
        {isProgram && isBlack && <div className="monitor-black">FADE TO BLACK</div>}
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
  const [message, setMessage] = useState('Local preview only. No signal is being broadcast.')
  const streams = useRef<MediaStream[]>([])
  const previewSource = sources.find((source) => source.id === previewId) ?? sources[0]
  const programSource = sources.find((source) => source.id === programId) ?? sources[0]

  useEffect(() => () => {
    streams.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()))
  }, [])

  async function addCapture(kind: 'camera' | 'screen') {
    try {
      const stream = kind === 'camera'
        ? await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const source: Source = {
        id: `${kind}-${Date.now()}`,
        name: kind === 'camera' ? 'CAMERA CAPTURE' : 'DESKTOP CAPTURE',
        kind,
        stream,
      }
      streams.current.push(stream)
      setSources((current) => [...current, source])
      setPreviewId(source.id)
      setMessage(`${source.name} added to preview.`)
    } catch {
      setMessage(`${kind === 'camera' ? 'Camera' : 'Screen capture'} was cancelled or unavailable.`)
    }
  }

  function takeProgram() {
    setProgramId(previewId)
    setIsBlack(false)
    setMessage(`${transition} to ${previewSource.name}. Local preview only.`)
  }

  const activeLowerThird = lowerOnAir ? { title: lowerTitle, detail: lowerDetail } : null

  return (
    <main className="studio-page">
      <header className="studio-heading">
        <div>
          <div className="eyebrow"><Radio size={13} /> GGTV STUDIO <span>/</span> SWITCHER</div>
          <h1>Studio switcher</h1>
        </div>
        <div className="studio-mode"><span className="status-light" /> LOCAL PREVIEW · API OFFLINE</div>
      </header>

      <div className="studio-notice"><AlertTriangle size={15} /><span>Switcher actions and graphics are local to this browser until the control API is connected.</span></div>

      <div className="monitor-grid">
        <Monitor source={previewSource} label="PREVIEW" lowerThird={null} ticker="" />
        <Monitor
          source={programSource}
          label="PROGRAM"
          isProgram
          isBlack={isBlack}
          lowerThird={activeLowerThird}
          ticker={tickerOnAir ? ticker : ''}
        />
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