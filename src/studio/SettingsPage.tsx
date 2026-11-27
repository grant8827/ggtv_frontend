import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound, Plug, Radio, Share2, Tv } from 'lucide-react'
import { api, errorMessage, type RestreamPlatform, type StreamSettings, type StudioLive } from '../api'
import { useSwitcher } from './switcherContext'
import CopyField from './CopyField'

const RESTREAM_HELP: Record<RestreamPlatform, string> = {
  youtube: 'In YouTube Studio choose Create → Go live → Stream, then copy the Stream URL and Stream key.',
  facebook: 'In Facebook Live Producer choose Streaming software, then copy the Server URL and Stream key.',
}

function RestreamSettings({ platform, live, onSaved }: { platform: RestreamPlatform; live: StudioLive; onSaved: (live: StudioLive) => void }) {
  const status = live.restream[platform]
  const [serverUrl, setServerUrl] = useState(status.serverUrl)
  const [streamKey, setStreamKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      onSaved(await api<StudioLive>(`/studio/restream/${platform}`, { method: 'PUT', body: { serverUrl, streamKey } }))
      setStreamKey('')
      setMessage('Saved.')
    } catch (caught) {
      setMessage(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="graphics-form" onSubmit={(event) => void save(event)}>
      <h3 className="settings-subhead">{status.name} <small>{status.state === 'off' ? 'OFF' : status.state.toUpperCase()}</small></h3>
      <p className="empty-note">{RESTREAM_HELP[platform]}</p>
      <label className="field-label">Server URL
        <input className="text-input" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="rtmp://…" required />
      </label>
      <label className="field-label">Stream key
        <input
          className="text-input"
          type="password"
          autoComplete="off"
          value={streamKey}
          onChange={(event) => setStreamKey(event.target.value)}
          placeholder={status.streamKeySet ? `Saved (ends ${status.streamKeyHint}). Leave blank to keep.` : 'Paste your stream key'}
        />
      </label>
      <div className="graphics-actions">
        <button className="button button-primary" type="submit" disabled={busy}>SAVE {status.name.toUpperCase()}</button>
      </div>
      {message && <p className="studio-message" role="status">{message}</p>}
    </form>
  )
}

function SettingsPage() {
  const { setLive } = useSwitcher()
  const [settings, setSettings] = useState<StreamSettings | null>(null)
  const [hlsBaseUrl, setHlsBaseUrl] = useState('')
  const [rtmpIngestUrl, setRtmpIngestUrl] = useState('')
  const [streamName, setStreamName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  function apply(next: StreamSettings) {
    setSettings(next)
    setHlsBaseUrl(next.hlsBaseUrl)
    setRtmpIngestUrl(next.rtmpIngestUrl)
    setStreamName(next.streamName)
    setLive(next.live)
  }

  useEffect(() => {
    api<StreamSettings>('/studio/settings').then(apply).catch((caught) => setMessage(errorMessage(caught)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!settings) return
    if (streamName.trim() !== settings.streamName
      && !window.confirm('Change the stream name? Encoders and the studio output using the old name will stop reaching the channel until they use the new stream key.')) return
    setBusy(true)
    setMessage('')
    try {
      apply(await api<StreamSettings>('/studio/settings', { method: 'PUT', body: { hlsBaseUrl, rtmpIngestUrl, streamName } }))
      setMessage('Settings saved.')
    } catch (caught) {
      setMessage(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function rotateKey() {
    if (!window.confirm('Generate a new stream key? Encoders using the old key will be disconnected on their next publish.')) return
    setBusy(true)
    setMessage('')
    try {
      const live = await api<StudioLive>('/studio/live/key', { method: 'POST', body: {} })
      setLive(live)
      setSettings((current) => current && { ...current, live })
      setMessage('New stream key generated. Update your encoder.')
    } catch (caught) {
      setMessage(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const live = settings?.live
  const apiUrl = `${window.location.origin}/api/live`

  return (
    <main className="studio-page">
      <header className="studio-heading">
        <div>
          <div className="eyebrow">GGTV STUDIO <span>/</span> SETTINGS</div>
          <h1>Settings</h1>
        </div>
      </header>

      {!settings && <p className="empty-note">{message || 'Loading settings…'}</p>}

      {settings && live && (
        <>
          <form className="control-panel" onSubmit={(event) => void save(event)}>
            <div className="control-panel-heading"><h2><Tv size={14} /> Stream URLs</h2><span>WEBSITE · TV APPS · ENCODERS</span></div>
            <div className="graphics-form">
              <label className="field-label">Playback URL (HLS)
                <input className="text-input" value={hlsBaseUrl} onChange={(event) => setHlsBaseUrl(event.target.value)} placeholder={settings.defaults.hlsBaseUrl} />
                <small className="settings-hint">The folder viewers, the website and the TV apps play the channel from. Leave blank to use the server default: {settings.defaults.hlsBaseUrl}</small>
              </label>
              <label className="field-label">Encoder server URL (RTMP)
                <input className="text-input" value={rtmpIngestUrl} onChange={(event) => setRtmpIngestUrl(event.target.value)} placeholder={settings.defaults.rtmpIngestUrl} />
                <small className="settings-hint">The server address you give OBS or vMix. Leave blank to use the server default: {settings.defaults.rtmpIngestUrl}</small>
              </label>
              <label className="field-label">Stream name
                <input className="text-input" value={streamName} onChange={(event) => setStreamName(event.target.value)} pattern="[A-Za-z0-9_\-]+" maxLength={64} required />
                <small className="settings-hint">Letters, numbers, - and _. Changing it changes the stream key you give encoders.</small>
              </label>
              <div className="graphics-actions">
                <button className="button button-primary" type="submit" disabled={busy}>SAVE SETTINGS</button>
              </div>
              {message && <p className="studio-message" role="status">{message}</p>}
            </div>
          </form>

          <section className="control-panel dash-section">
            <div className="control-panel-heading"><h2><Radio size={14} /> Channel feed</h2><span>FOR CABLE COMPANIES AND PARTNERS</span></div>
            <div className="graphics-form">
              <CopyField label="Channel URL (HLS)" value={settings.channelHlsUrl} />
              <p className="empty-note">
                One address that always carries what is on air: the live show while you are live, the playlist otherwise, and a black slate when nothing is scheduled.
                The address stays the same when you switch between playlist and live; the switch shows as a short cut of a few seconds.
              </p>
              <p className="settings-hint">
                Now sending: {settings.channelFeed.source === 'relay' ? (live.isLive ? 'the live show' : 'the playlist') : settings.channelFeed.source === 'slate' ? 'the off-air slate' : 'starting…'}
                {settings.channelFeed.error && ` · last error: ${settings.channelFeed.error}`}
              </p>
            </div>
          </section>

          <section className="control-panel dash-section">
            <div className="control-panel-heading"><h2><Plug size={14} /> Current addresses</h2><span>COPY INTO YOUR APPS AND ENCODER</span></div>
            <div className="encoder-grid">
              <CopyField label="Live stream URL" value={settings.liveHlsUrl} />
              <CopyField label="Playlist stream URL" value={settings.playoutHlsUrl} />
              <CopyField label="Encoder server" value={live.rtmpUrl} />
              <CopyField label="Encoder stream key" value={`${live.streamName}?key=${live.streamKey}`} secret />
              <CopyField label="Channel status API (used by the TV apps)" value={apiUrl} />
            </div>
            <div className="encoder-footer">
              <p className="empty-note">The TV apps ask the status API which stream URL to play, so a new playback URL reaches them without updating the apps.</p>
              <button className="button button-muted" type="button" onClick={() => void rotateKey()} disabled={busy}><KeyRound size={13} /> NEW KEY</button>
            </div>
          </section>

          <section className="control-panel dash-section">
            <div className="control-panel-heading"><h2><Share2 size={14} /> Restreaming</h2><span>YOUTUBE · FACEBOOK</span></div>
            <div className="encoder-grid">
              {(Object.keys(live.restream) as RestreamPlatform[]).map((platform) => (
                <RestreamSettings key={platform} platform={platform} live={live} onSaved={(next) => { setLive(next); setSettings((current) => current && { ...current, live: next }) }} />
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}

export default SettingsPage
