import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Mic, MicOff, Power, RadioTower, Settings } from 'lucide-react'
import { api, type RestreamPlatform, type StudioLive } from '../api'
import { useSwitcher } from './switcherContext'
import { Popover } from './Popover'
import { usePopover } from './usePopover'

// ---------- microphone ----------

// Chrome lists "default" and "communications" as extra copies of real inputs; the first option covers them.
const ALIAS_DEVICES = new Set(['default', 'communications'])

export function MicControl() {
  const { output } = useSwitcher()
  const { open, setOpen, view, setView, ref, show } = usePopover()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceError, setDeviceError] = useState('')

  const loadDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((device) => device.kind === 'audioinput' && !ALIAS_DEVICES.has(device.deviceId)))
    } catch {
      setDeviceError('This browser cannot list microphones.')
    }
  }, [])

  // Browsers hide input names until the page has been allowed to use the microphone once.
  const allowAccess = async () => {
    setDeviceError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      await loadDevices()
    } catch {
      setDeviceError('Microphone access was blocked. Allow it in the browser address bar, then try again.')
    }
  }

  const settingsOpen = open && view === 'settings'
  useEffect(() => {
    if (!settingsOpen) return
    navigator.mediaDevices.addEventListener('devicechange', loadDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices)
  }, [settingsOpen, loadDevices])

  // On: one click turns it off. Off: the click opens the menu.
  const onClick = () => {
    if (output.micOn) {
      output.turnMicOff()
      setOpen(false)
    } else {
      show()
    }
  }

  const turnOn = async () => {
    setOpen(false)
    await output.turnMicOn()
  }

  const namesHidden = devices.length > 0 && devices.every((device) => !device.label)
  const savedMissing = output.micDeviceId && devices.length > 0 && !devices.some((device) => device.deviceId === output.micDeviceId)

  return (
    <div className="output-control" ref={ref}>
      <button
        className={output.micOn ? 'capture-button active' : 'capture-button'}
        type="button"
        onClick={onClick}
        aria-pressed={output.micOn}
        aria-expanded={open}
        title={output.micOn ? 'Turn the microphone off' : 'Microphone options'}
      >
        {output.micOn ? <Mic size={14} /> : <MicOff size={14} />} {output.micOn ? 'MIC ON' : 'MIC OFF'}
      </button>

      {open && view === 'menu' && (
        <Popover title="Microphone">
          <div className="popover-actions">
            <button className="button button-primary" type="button" onClick={() => void turnOn()}><Power size={13} /> TURN ON</button>
            <button className="button button-muted" type="button" onClick={() => { setView('settings'); void loadDevices() }}><Settings size={13} /> SETTINGS</button>
          </div>
        </Popover>
      )}

      {settingsOpen && (
        <Popover title="Microphone settings" onBack={() => setView('menu')}>
          <label className="field-label">Input
            <select className="text-input" value={savedMissing ? '' : output.micDeviceId} onChange={(event) => void output.chooseMic(event.target.value)}>
              <option value="">Default microphone</option>
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>
              ))}
            </select>
          </label>
          {namesHidden && (
            <button className="popover-link" type="button" onClick={() => void allowAccess()}>Show microphone names</button>
          )}
          {savedMissing && <p className="popover-note">The microphone you chose last time isn't connected, so the default will be used.</p>}
          {deviceError && <p className="popover-note error">{deviceError}</p>}
          <div className="popover-actions">
            <button className="button button-primary" type="button" onClick={() => void turnOn()}><Power size={13} /> TURN ON</button>
          </div>
        </Popover>
      )}
    </div>
  )
}

// ---------- YouTube / Facebook ----------

function YoutubeIcon() {
  return (
    <svg className="platform-icon youtube" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8A26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
    </svg>
  )
}

function FacebookIcon() {
  return (
    <svg className="platform-icon facebook" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" />
    </svg>
  )
}

const PLATFORM_UI: Record<RestreamPlatform, { label: string; icon: () => ReactNode; help: string }> = {
  youtube: {
    label: 'YOUTUBE',
    icon: YoutubeIcon,
    help: 'In YouTube Studio choose Create → Go live → Stream, then copy the Stream URL and Stream key.',
  },
  facebook: {
    label: 'FACEBOOK',
    icon: FacebookIcon,
    help: 'In Facebook Live Producer choose Streaming software, then copy the Server URL and Stream key.',
  },
}

export function RestreamControl({ platform }: { platform: RestreamPlatform }) {
  const { live, setLive, output } = useSwitcher()
  const { open, setOpen, view, setView, ref, show } = usePopover()
  const status = live?.restream?.[platform]
  const ui = PLATFORM_UI[platform]
  const Icon = ui.icon
  const [serverUrl, setServerUrl] = useState('')
  const [streamKey, setStreamKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const state = status?.state ?? 'off'
  const name = status?.name ?? ui.label

  const call = async (path: string, body: unknown = {}, method = 'POST') => {
    setBusy(true)
    setError('')
    try {
      setLive(await api<StudioLive>(`/studio/restream/${platform}${path}`, { method, body }))
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.')
      return false
    } finally {
      setBusy(false)
    }
  }

  // Live (or connecting): one click ends it. Off: the click opens the menu.
  const onClick = () => {
    if (state !== 'off') {
      setOpen(false)
      void call('/stop')
    } else {
      setError('')
      show()
    }
  }

  const goLive = async () => {
    if (await call('/start')) setOpen(false)
  }

  const openSettings = () => {
    setServerUrl(status?.serverUrl ?? '')
    setStreamKey('')
    setSaved(false)
    setError('')
    setView('settings')
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (await call('', { serverUrl, streamKey }, 'PUT')) {
      setStreamKey('')
      setSaved(true)
    }
  }

  const buttonLabel = state === 'live' ? `${ui.label} LIVE` : state === 'connecting' ? 'CONNECTING' : ui.label
  const title = state === 'off' ? `${name} options` : `Stop streaming to ${name}`

  return (
    <div className="output-control" ref={ref}>
      <button
        className={`capture-button restream-button restream-${state}`}
        type="button"
        onClick={onClick}
        disabled={!live || busy}
        aria-pressed={state !== 'off'}
        aria-expanded={open}
        title={status?.error && state === 'connecting' ? `${title}. Last error: ${status.error}` : title}
      >
        <Icon /> {buttonLabel}
      </button>

      {open && view === 'menu' && (
        <Popover title={name}>
          {!status?.streamKeySet && <p className="popover-note">Add your {name} stream key in settings before going live.</p>}
          {status?.streamKeySet && output.state !== 'streaming' && (
            <p className="popover-note">Start the output too. {name} receives PROGRAM once the output is running.</p>
          )}
          {error && <p className="popover-note error">{error}</p>}
          <div className="popover-actions">
            <button className="button button-primary" type="button" onClick={() => void goLive()} disabled={busy || !status?.streamKeySet}>
              <RadioTower size={13} /> GO LIVE
            </button>
            <button className="button button-muted" type="button" onClick={openSettings}><Settings size={13} /> SETTINGS</button>
          </div>
        </Popover>
      )}

      {open && view === 'settings' && (
        <Popover title={`${name} settings`} onBack={() => setView('menu')}>
          <form className="popover-form" onSubmit={(event) => void save(event)}>
            <p className="popover-note">{ui.help}</p>
            <label className="field-label">Server URL
              <input className="text-input" value={serverUrl} onChange={(event) => { setServerUrl(event.target.value); setSaved(false) }} placeholder="rtmp://…" required />
            </label>
            <label className="field-label">Stream key
              <input
                className="text-input"
                type="password"
                autoComplete="off"
                value={streamKey}
                onChange={(event) => { setStreamKey(event.target.value); setSaved(false) }}
                placeholder={status?.streamKeySet ? `Saved (ends ${status.streamKeyHint}). Leave blank to keep.` : 'Paste your stream key'}
              />
            </label>
            {error && <p className="popover-note error">{error}</p>}
            {saved && <p className="popover-note ok">Saved.</p>}
            <div className="popover-actions">
              <button className="button button-primary" type="submit" disabled={busy}>SAVE</button>
            </div>
          </form>
        </Popover>
      )}
    </div>
  )
}
