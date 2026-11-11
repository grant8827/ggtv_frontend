import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Mic, MicOff, PhoneOff, Video, VideoOff, Volume2 } from 'lucide-react'

type Phase = 'loading' | 'invalid' | 'setup' | 'waiting' | 'connecting' | 'live' | 'ended'

// Close codes the server uses when a guest should not reconnect on their own.
const FINAL_CLOSES: Record<number, string> = {
  4001: 'The studio ended your connection. Thanks for joining!',
  4002: 'This invite link was opened in another window, so this one was disconnected.',
  4003: 'This invite link was cancelled by the studio.',
}

function useDevices(kind: MediaDeviceKind, refreshKey: unknown) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    const load = () => navigator.mediaDevices.enumerateDevices()
      .then((all) => setDevices(all.filter((device) => device.kind === kind && device.deviceId !== 'default' && device.deviceId !== 'communications')))
      .catch(() => undefined)
    void load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [kind, refreshKey])
  return devices
}

// The page an invited guest opens. They check their camera and mic, join, and are connected
// straight to the studio's browser: it receives their video, and they see and hear the show.
function GuestPage() {
  const { token = '' } = useParams()
  const [phase, setPhase] = useState<Phase>('loading')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [local, setLocal] = useState<MediaStream | null>(null)
  const [cameraId, setCameraId] = useState('')
  const [micId, setMicId] = useState('')
  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  // The browser refused to start the show with sound (autoplay rules, mostly phones); a tap fixes it.
  const [soundBlocked, setSoundBlocked] = useState(false)
  const selfView = useRef<HTMLVideoElement>(null)
  const showView = useRef<HTMLVideoElement>(null)
  const localRef = useRef<MediaStream | null>(null)
  const call = useRef<{ ws: WebSocket; pc: RTCPeerConnection | null } | null>(null)
  // Lets a dropped connection call `join` again from inside `join` itself.
  const rejoin = useRef<() => void>(() => undefined)
  const cameras = useDevices('videoinput', local)
  const mics = useDevices('audioinput', local)

  useEffect(() => {
    document.title = 'Join GGTV as a guest'
    fetch(`/api/guest/${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || 'This invite link isn\'t valid.')
        setName(body.name)
        setPhase('setup')
      })
      .catch((error: Error) => {
        setNote(error.message)
        setPhase('invalid')
      })
  }, [token])

  // Opens (or re-opens, after choosing another device) the camera and microphone.
  const openDevices = useCallback(async (nextCamera: string, nextMic: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { ...(nextCamera ? { deviceId: { exact: nextCamera } } : {}), width: 1280, height: 720 },
        audio: { ...(nextMic ? { deviceId: { exact: nextMic } } : {}), echoCancellation: true, noiseSuppression: true },
      })
      localRef.current?.getTracks().forEach((track) => track.stop())
      localRef.current = stream
      stream.getAudioTracks().forEach((track) => { track.enabled = micOn })
      stream.getVideoTracks().forEach((track) => { track.enabled = cameraOn })
      setLocal(stream)
      setNote('')
      // Already in the call: swap the new devices in without reconnecting.
      const pc = call.current?.pc
      pc?.getTransceivers().forEach((transceiver) => {
        const kind = transceiver.receiver.track.kind
        const track = kind === 'video' ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0]
        if (track) void transceiver.sender.replaceTrack(track)
      })
    } catch {
      setNote('Your camera or microphone is blocked or in use. Allow access in the address bar, close other video apps, then try again.')
    }
  }, [micOn, cameraOn])

  useEffect(() => {
    if (phase !== 'setup' || localRef.current) return
    void openDevices('', '')
  }, [phase, openDevices])

  useEffect(() => {
    if (selfView.current) selfView.current.srcObject = local
  }, [local, phase])

  useEffect(() => () => {
    call.current?.pc?.close()
    call.current?.ws.close()
    localRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  const join = useCallback(() => {
    const stream = localRef.current
    if (!stream) return
    setPhase('waiting')
    let iceServers: RTCIceServer[] = []
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/guest/signal?token=${encodeURIComponent(token)}`)
    const current: { ws: WebSocket; pc: RTCPeerConnection | null } = { ws, pc: null }
    call.current = current
    let pending: RTCIceCandidateInit[] = []
    const send = (data: unknown) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'signal', data }))

    // The studio calls us; each new offer (e.g. after the studio reloads) replaces the old call.
    const answer = async (description: RTCSessionDescriptionInit) => {
      current.pc?.close()
      const pc = new RTCPeerConnection({ iceServers })
      current.pc = pc
      pending = []
      const remote = new MediaStream()
      pc.ontrack = (event) => {
        remote.addTrack(event.track)
        const view = showView.current
        if (!view) return
        if (view.srcObject !== remote) view.srcObject = remote
        // Played again for each track, so the studio's audio starts as well as its video.
        view.play().then(() => setSoundBlocked(false)).catch((error: DOMException) => {
          if (error.name === 'NotAllowedError') setSoundBlocked(true)
        })
      }
      pc.onicecandidate = (event) => event.candidate && send({ candidate: event.candidate.toJSON() })
      pc.onconnectionstatechange = () => {
        if (current.pc !== pc) return
        if (pc.connectionState === 'connected') setPhase('live')
        else if (pc.connectionState === 'failed') {
          setPhase('connecting')
          setNote('The video connection failed. Your network may block video calls; try another Wi-Fi or mobile data.')
        }
      }
      await pc.setRemoteDescription(description)
      const media = localRef.current ?? stream
      pc.getTransceivers().forEach((transceiver) => {
        const kind = transceiver.receiver.track.kind
        const track = kind === 'video' ? media.getVideoTracks()[0] : media.getAudioTracks()[0]
        transceiver.direction = 'sendrecv'
        if (track) void transceiver.sender.replaceTrack(track)
      })
      await pc.setLocalDescription(await pc.createAnswer())
      send({ description: pc.localDescription?.toJSON() })
      for (const candidate of pending.splice(0)) await pc.addIceCandidate(candidate)
    }

    ws.onmessage = (event) => {
      if (call.current !== current) return
      const message = JSON.parse(event.data)
      if (message.type === 'welcome') {
        iceServers = message.iceServers
        setPhase(message.studioReady ? 'connecting' : 'waiting')
      } else if (message.type === 'studio-ready') {
        setPhase('connecting')
      } else if (message.type === 'studio-away') {
        current.pc?.close()
        current.pc = null
        setPhase('waiting')
      } else if (message.type === 'signal') {
        const data = message.data
        if (data.description) {
          setPhase('connecting')
          void answer(data.description).catch(() => setNote('Could not connect the video. Try leaving and joining again.'))
        } else if (data.candidate) {
          if (current.pc?.remoteDescription) void current.pc.addIceCandidate(data.candidate).catch(() => undefined)
          else pending.push(data.candidate)
        }
      }
    }
    ws.onclose = (event) => {
      if (call.current !== current) return
      current.pc?.close()
      current.pc = null
      if (FINAL_CLOSES[event.code]) {
        call.current = null
        setNote(FINAL_CLOSES[event.code])
        setPhase('ended')
      } else {
        // A dropped connection (Wi-Fi blip, server restart): try again shortly.
        setPhase('waiting')
        window.setTimeout(() => { if (call.current === current) rejoin.current() }, 3000)
      }
    }
  }, [token])

  useEffect(() => {
    rejoin.current = join
  })

  const leave = () => {
    const current = call.current
    call.current = null
    current?.pc?.close()
    current?.ws.close()
    setNote('You left the studio. You can join again with the same link.')
    setPhase('ended')
  }

  const enableSound = () => {
    const view = showView.current
    if (!view) return
    view.muted = false
    view.play().then(() => setSoundBlocked(false)).catch(() => undefined)
  }

  const toggleMic = () => {
    const next = !micOn
    localRef.current?.getAudioTracks().forEach((track) => { track.enabled = next })
    setMicOn(next)
  }
  const toggleCamera = () => {
    const next = !cameraOn
    localRef.current?.getVideoTracks().forEach((track) => { track.enabled = next })
    setCameraOn(next)
  }

  const inCall = phase === 'waiting' || phase === 'connecting' || phase === 'live'
  const statusText = phase === 'waiting' ? 'Waiting for the studio to open…'
    : phase === 'connecting' ? 'Connecting to the studio…'
      : phase === 'live' ? 'Connected. The studio can see and hear you.' : ''

  return (
    <main className="guest-page">
      <header className="guest-header">
        <img className="brand-logo" src="/logo.png" alt="GGTV" />
        {inCall && <span className={phase === 'live' ? 'guest-pill live' : 'guest-pill'}><span className="status-light" /> {phase === 'live' ? 'CONNECTED' : 'CONNECTING'}</span>}
      </header>

      {phase === 'loading' && <p className="guest-copy">Checking your invite…</p>}

      {(phase === 'invalid' || phase === 'ended') && (
        <section className="guest-card">
          <h1>{phase === 'invalid' ? 'Invite not found' : 'Disconnected'}</h1>
          <p className="guest-copy">{note}</p>
          {phase === 'ended' && local && <button className="button button-primary" type="button" onClick={join}>JOIN AGAIN</button>}
        </section>
      )}

      {phase === 'setup' && (
        <section className="guest-card">
          <h1>Hi {name}, you're invited to GGTV</h1>
          <p className="guest-copy">Check your camera and microphone, then join. Headphones help avoid echo.</p>
          <div className="guest-self large"><video ref={selfView} autoPlay muted playsInline /></div>
          <div className="guest-devices">
            <label className="field-label">Camera
              <select className="text-input" value={cameraId} onChange={(event) => { setCameraId(event.target.value); void openDevices(event.target.value, micId) }}>
                <option value="">Default camera</option>
                {cameras.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
              </select>
            </label>
            <label className="field-label">Microphone
              <select className="text-input" value={micId} onChange={(event) => { setMicId(event.target.value); void openDevices(cameraId, event.target.value) }}>
                <option value="">Default microphone</option>
                {mics.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
              </select>
            </label>
          </div>
          {note && <p className="form-error">{note}</p>}
          <button className="button button-primary guest-join" type="button" onClick={join} disabled={!local}>JOIN THE STUDIO</button>
        </section>
      )}

      {inCall && (
        <section className="guest-call">
          <div className="guest-show">
            <video ref={showView} autoPlay playsInline />
            {phase !== 'live' && <div className="guest-show-wait">{statusText}</div>}
            <span className="guest-show-label">THE SHOW</span>
            {soundBlocked && (
              <button className="button button-primary guest-sound-button" type="button" onClick={enableSound}>
                <Volume2 size={14} /> TAP TO HEAR THE STUDIO
              </button>
            )}
            <div className="guest-self"><video ref={selfView} autoPlay muted playsInline /></div>
          </div>
          <p className="guest-copy" role="status">{statusText}{note ? ` ${note}` : ''}</p>
          <div className="guest-controls">
            <button className={micOn ? 'button button-muted' : 'button button-danger'} type="button" onClick={toggleMic}>{micOn ? <Mic size={14} /> : <MicOff size={14} />} {micOn ? 'MUTE' : 'UNMUTE'}</button>
            <button className={cameraOn ? 'button button-muted' : 'button button-danger'} type="button" onClick={toggleCamera}>{cameraOn ? <Video size={14} /> : <VideoOff size={14} />} {cameraOn ? 'CAMERA OFF' : 'CAMERA ON'}</button>
            <button className="button button-danger" type="button" onClick={leave}><PhoneOff size={14} /> LEAVE</button>
          </div>
        </section>
      )}
    </main>
  )
}

export default GuestPage
