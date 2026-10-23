import { useEffect, useState, type FormEvent } from 'react'
import { Copy, Eye, EyeOff, KeyRound, Plug, RadioTower, Square } from 'lucide-react'
import { api, errorMessage, formatTime, type StudioLive } from '../api'
import HlsPlayer from '../HlsPlayer'

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [revealed, setRevealed] = useState(!secret)
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <label className="field-label">{label}
      <span className="copy-field">
        <input className="text-input" readOnly value={revealed ? value : '•'.repeat(24)} />
        {secret && (
          <button className="dash-icon-button light" type="button" onClick={() => setRevealed((current) => !current)} aria-label={revealed ? 'Hide' : 'Show'}>
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
        <button className="dash-icon-button light" type="button" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          <Copy size={14} />
        </button>
      </span>
      {copied && <small className="copy-note">Copied</small>}
    </label>
  )
}

function GoLivePage() {
  const [live, setLive] = useState<StudioLive | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    api<StudioLive>('/studio/live')
      .then((state) => {
        setLive(state)
        setTitle(state.title)
        setDescription(state.description)
      })
      .catch((caught) => setMessage(errorMessage(caught)))
  }, [])

  async function run(path: string, body: unknown, done: string) {
    setBusy(true)
    setMessage('')
    try {
      setLive(await api<StudioLive>(path, { method: 'POST', body }))
      setMessage(done)
    } catch (caught) {
      setMessage(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function goLive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void run('/studio/live/start', { title, description }, live?.isLive ? 'Broadcast details updated.' : 'You are on air.')
  }

  function endBroadcast() {
    if (!window.confirm('End the broadcast? Viewers will see the channel as off air.')) return
    void run('/studio/live/stop', {}, 'Broadcast ended.')
  }

  function rotateKey() {
    if (!window.confirm('Generate a new stream key? Encoders using the old key will be disconnected on their next publish.')) return
    void run('/studio/live/key', {}, 'New stream key generated. Update your encoder.')
  }

  return (
    <main className="studio-page">
      <header className="studio-heading">
        <div>
          <div className="eyebrow">GGTV STUDIO <span>/</span> GO LIVE</div>
          <h1>Live broadcast</h1>
        </div>
        <div className={live?.isLive ? 'on-air-badge live' : 'on-air-badge'}>
          <span className="status-light" /> {live?.isLive ? `ON AIR SINCE ${formatTime(live.startedAt!)}` : 'OFF AIR'}
        </div>
      </header>

      <div className="live-grid">
        <section className="monitor-panel program">
          <div className="monitor-header"><span>INGEST MONITOR</span><small>{live?.encoderConnected ? 'ENCODER CONNECTED' : 'WAITING FOR ENCODER'}</small></div>
          {live ? <HlsPlayer src={live.hlsUrl} channelName="Ingest monitor" /> : <div className="player-frame" />}
          <p className="monitor-source">HLS: {live?.hlsUrl ?? '—'}</p>
        </section>

        <form className="control-panel" onSubmit={goLive}>
          <div className="control-panel-heading"><h2>Broadcast details</h2><span>SHOWN TO VIEWERS</span></div>
          <div className="graphics-form">
            <label className="field-label">Title
              <input className="text-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required />
            </label>
            <label className="field-label">Description
              <textarea className="text-input text-area" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} />
            </label>
            <div className="graphics-actions">
              <button className="button button-primary" type="submit" disabled={busy || !live}>
                <RadioTower size={14} /> {live?.isLive ? 'UPDATE DETAILS' : 'GO LIVE'}
              </button>
              {live?.isLive && (
                <button className="button button-danger" type="button" onClick={endBroadcast} disabled={busy}>
                  <Square size={13} /> END BROADCAST
                </button>
              )}
            </div>
            {message && <p className="studio-message" role="status">{message}</p>}
          </div>
        </form>
      </div>

      <section className="control-panel dash-section">
        <div className="control-panel-heading"><h2><Plug size={14} /> Encoder setup</h2><span>OBS · VMIX · FFMPEG</span></div>
        {live && (
          <div className="encoder-grid">
            <CopyField label="Server" value={live.rtmpUrl} />
            <CopyField label="Stream key" value={`${live.streamName}?key=${live.streamKey}`} secret />
          </div>
        )}
        <div className="encoder-footer">
          <p className="empty-note">Start your encoder first and check the monitor, then press Go live to put the channel on air for viewers.</p>
          <button className="button button-muted" type="button" onClick={rotateKey} disabled={busy || !live}><KeyRound size={13} /> NEW KEY</button>
        </div>
      </section>
    </main>
  )
}

export default GoLivePage
