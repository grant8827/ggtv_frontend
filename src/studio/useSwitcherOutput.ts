import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type OutputState = 'idle' | 'connecting' | 'streaming' | 'error'

const MIME_TYPES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
const CHUNK_MS = 500
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

// `destination` is the program mix. `talkback` is what invited guests hear: the studio mic only,
// so they never hear their own voice coming back.
type Audio = { context: AudioContext; destination: MediaStreamAudioDestinationNode; talkback: MediaStreamAudioDestinationNode }

// The microphone input chosen in the mic settings, remembered per browser. Empty means the default input.
const MIC_DEVICE_KEY = 'ggtv.micDeviceId'

function savedMicDevice() {
  try {
    return localStorage.getItem(MIC_DEVICE_KEY) ?? ''
  } catch {
    return ''
  }
}

// Records the program canvas (plus optional microphone) and streams it to the backend,
// which publishes it to SRS as the live encoder.
export function useSwitcherOutput(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const [state, setState] = useState<OutputState>('idle')
  const [message, setMessage] = useState('')
  const [micOn, setMicOn] = useState(false)
  // True while the browser keeps the audio graph paused. Chrome starts an AudioContext paused when
  // it is created outside a click (e.g. when a guest connects), and then nothing is heard here and
  // guests hear nothing from the studio until a click or key press resumes it.
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [micDeviceId, setMicDeviceId] = useState(savedMicDevice)
  const micDeviceRef = useRef(micDeviceId)
  const socket = useRef<WebSocket | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const audio = useRef<Audio | null>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const mic = useRef<{ stream: MediaStream; node: MediaStreamAudioSourceNode } | null>(null)
  const mediaGains = useRef(new Map<string, { gain: GainNode; node: AudioNode }>())
  const programIds = useRef(new Set<string>())

  const ensureAudio = useCallback(() => {
    if (!audio.current) {
      const context = new AudioContext()
      setAudioBlocked(context.state === 'suspended')
      context.addEventListener('statechange', () => setAudioBlocked(context.state === 'suspended'))
      const destination = context.createMediaStreamDestination()
      // A destination with nothing connected produces no audio at all, and MediaRecorder then
      // waits for audio and records nothing. A constant zero signal keeps silent audio flowing.
      const silence = context.createConstantSource()
      silence.offset.value = 0
      silence.connect(destination)
      silence.start()
      const talkback = context.createMediaStreamDestination()
      silence.connect(talkback)
      audio.current = { context, destination, talkback }
    }
    return audio.current
  }, [])

  // Each path that ends the output clears `socket` first, so the socket's own close event is ignored.
  // Sources with sound (playlists, shared screens and tabs, guests) are heard in the output only
  // while they are on PROGRAM, alone or in a layout.
  const attachAudio = useCallback((id: string, input: HTMLVideoElement | MediaStream, options: { monitor?: boolean } = {}) => {
    const { context, destination } = ensureAudio()
    void context.resume()
    const isStream = input instanceof MediaStream
    const node = isStream ? context.createMediaStreamSource(input) : context.createMediaElementSource(input)
    const gain = context.createGain()
    gain.gain.value = programIds.current.has(id) ? 1 : 0
    node.connect(gain)
    gain.connect(destination)
    // A playlist's sound now only comes out of this graph, so it also goes to this computer's
    // speakers for the operator. A shared screen or tab is already playing on this computer.
    if (!isStream) gain.connect(context.destination)
    // Guests are always heard here, on or off PROGRAM, so the operator can talk to them before air.
    if (options.monitor) node.connect(context.destination)
    mediaGains.current.set(id, { gain, node })
  }, [ensureAudio])

  const detachAudio = useCallback((id: string) => {
    const entry = mediaGains.current.get(id)
    entry?.gain.disconnect()
    entry?.node.disconnect()
    mediaGains.current.delete(id)
  }, [])

  const setProgramAudio = useCallback((ids: string[]) => {
    programIds.current = new Set(ids)
    const context = audio.current?.context
    mediaGains.current.forEach(({ gain }, sourceId) => {
      if (context) gain.gain.setTargetAtTime(programIds.current.has(sourceId) ? 1 : 0, context.currentTime, 0.08)
    })
  }, [])

  // Resumes a paused audio graph. Only works from inside a click or key press.
  const unlockAudio = useCallback(() => {
    const context = audio.current?.context
    if (context?.state === 'suspended') void context.resume()
  }, [])

  // Any click or key press in the studio resumes the audio graph, so sound starts as soon as the
  // operator does anything, without a separate "enable sound" step.
  useEffect(() => {
    const options = { capture: true }
    document.addEventListener('pointerdown', unlockAudio, options)
    document.addEventListener('keydown', unlockAudio, options)
    return () => {
      document.removeEventListener('pointerdown', unlockAudio, options)
      document.removeEventListener('keydown', unlockAudio, options)
    }
  }, [unlockAudio])

  // The audio track sent back to guests (the studio mic when it is on, otherwise silence).
  const talkbackTrack = useCallback(() => {
    const { context, talkback } = ensureAudio()
    void context.resume()
    return talkback.stream.getAudioTracks()[0]
  }, [ensureAudio])

  // Keeps the screen (and so the computer) awake while sending. Browsers drop the lock when the
  // tab is hidden, so it is taken again whenever the tab comes back.
  useEffect(() => {
    if (state !== 'streaming' || !navigator.wakeLock) return
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== 'visible' || wakeLock.current) return
      navigator.wakeLock.request('screen').then((lock) => {
        if (cancelled) void lock.release()
        else {
          wakeLock.current = lock
          lock.addEventListener('release', () => { wakeLock.current = null })
        }
      }).catch(() => undefined)
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      void wakeLock.current?.release()
      wakeLock.current = null
    }
  }, [state])

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    recorder.current = null
    const ws = socket.current
    socket.current = null
    // Let the final recorder chunk go out before closing.
    if (ws) window.setTimeout(() => ws.close(1000), CHUNK_MS)
    setState('idle')
    setMessage('Output stopped.')
  }, [])

  const fail = useCallback((text: string) => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    recorder.current = null
    socket.current?.close()
    socket.current = null
    setState('error')
    setMessage(text)
  }, [])

  const start = useCallback(async () => {
    const canvas = canvasRef.current
    const mimeType = pickMimeType()
    if (!canvas || !mimeType) {
      setState('error')
      setMessage('This browser cannot record the program output. Use a current Chrome or Edge.')
      return
    }

    setState('connecting')
    setMessage('Connecting to the GGTV origin…')

    const { context, destination } = ensureAudio()
    await context.resume()
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...destination.stream.getAudioTracks()])

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/studio/switcher/output`)
    ws.binaryType = 'arraybuffer'
    socket.current = ws

    ws.onmessage = (event) => {
      if (socket.current !== ws || typeof event.data !== 'string' || JSON.parse(event.data).type !== 'ready') return
      const media = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 })
      media.ondataavailable = (chunk) => {
        if (!chunk.data.size || ws.readyState !== WebSocket.OPEN) return
        if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
          fail('Your connection is too slow to keep up with the output. Stopped to avoid a broken stream.')
          return
        }
        ws.send(chunk.data)
      }
      media.start(CHUNK_MS)
      recorder.current = media
      setState('streaming')
      setMessage('Program output is reaching the origin. Press GO LIVE to put it on air.')
    }

    ws.onclose = (event) => {
      if (socket.current !== ws) return
      const reason = event.reason || (event.code === 1006
        ? 'Could not open the output. Another switcher or encoder may already be live, or your studio session expired.'
        : 'The output connection closed.')
      fail(reason)
    }
  }, [canvasRef, ensureAudio, fail])

  const turnMicOff = useCallback(() => {
    if (!mic.current) return
    mic.current.node.disconnect()
    mic.current.stream.getTracks().forEach((track) => track.stop())
    mic.current = null
    setMicOn(false)
  }, [])

  const turnMicOn = useCallback(async () => {
    if (mic.current) return
    const audioOptions = { echoCancellation: true, noiseSuppression: true }
    const deviceId = micDeviceRef.current
    let stream: MediaStream
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...audioOptions, deviceId: { exact: deviceId } } : audioOptions })
      } catch (error) {
        // The chosen input was unplugged: fall back to the computer's default microphone.
        if (!deviceId || (error as DOMException).name !== 'OverconstrainedError') throw error
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioOptions })
        setMessage('The selected microphone was not found, so the default microphone is on.')
      }
    } catch {
      setMessage('Microphone access was blocked or unavailable.')
      return
    }
    const { context, destination } = ensureAudio()
    void context.resume()
    const node = context.createMediaStreamSource(stream)
    node.connect(destination)
    node.connect(audio.current!.talkback)
    mic.current = { stream, node }
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (mic.current?.stream !== stream) return
      turnMicOff()
      setMessage('The microphone was disconnected.')
    })
    setMicOn(true)
  }, [ensureAudio, turnMicOff])

  // Picks which microphone input to use; switches over straight away if the mic is on.
  const chooseMic = useCallback(async (deviceId: string) => {
    micDeviceRef.current = deviceId
    setMicDeviceId(deviceId)
    try {
      localStorage.setItem(MIC_DEVICE_KEY, deviceId)
    } catch {
      // Storage can be unavailable (private windows); the choice still holds for this visit.
    }
    if (mic.current) {
      turnMicOff()
      await turnMicOn()
    }
  }, [turnMicOff, turnMicOn])

  useEffect(() => () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    const ws = socket.current
    socket.current = null
    ws?.close(1000)
    mic.current?.stream.getTracks().forEach((track) => track.stop())
    void audio.current?.context.close()
  }, [])

  return { state, message, micOn, micDeviceId, audioBlocked, unlockAudio, start, stop, turnMicOn, turnMicOff, chooseMic, attachAudio, detachAudio, setProgramAudio, talkbackTrack }
}
