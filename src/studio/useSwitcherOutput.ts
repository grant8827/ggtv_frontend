import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type OutputState = 'idle' | 'connecting' | 'streaming' | 'error'

const MIME_TYPES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
const CHUNK_MS = 500
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

type Audio = { context: AudioContext; destination: MediaStreamAudioDestinationNode }

// Records the program canvas (plus optional microphone) and streams it to the backend,
// which publishes it to SRS as the live encoder.
export function useSwitcherOutput(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const [state, setState] = useState<OutputState>('idle')
  const [message, setMessage] = useState('')
  const [micOn, setMicOn] = useState(false)
  const socket = useRef<WebSocket | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const audio = useRef<Audio | null>(null)
  const mic = useRef<{ stream: MediaStream; node: MediaStreamAudioSourceNode } | null>(null)
  const mediaGains = useRef(new Map<string, { gain: GainNode; node: MediaElementAudioSourceNode }>())
  const programId = useRef('')

  const ensureAudio = useCallback(() => {
    if (!audio.current) {
      const context = new AudioContext()
      const destination = context.createMediaStreamDestination()
      // A destination with nothing connected produces no audio at all, and MediaRecorder then
      // waits for audio and records nothing. A constant zero signal keeps silent audio flowing.
      const silence = context.createConstantSource()
      silence.offset.value = 0
      silence.connect(destination)
      silence.start()
      audio.current = { context, destination }
    }
    return audio.current
  }, [])

  // Each path that ends the output clears `socket` first, so the socket's own close event is ignored.
  // Sources with sound (playlists) are heard only while they are on PROGRAM, in the output
  // and on this computer's speakers so the operator hears what goes out.
  const attachAudio = useCallback((id: string, element: HTMLVideoElement) => {
    const { context, destination } = ensureAudio()
    void context.resume()
    const node = context.createMediaElementSource(element)
    const gain = context.createGain()
    gain.gain.value = id === programId.current ? 1 : 0
    node.connect(gain)
    gain.connect(destination)
    gain.connect(context.destination)
    mediaGains.current.set(id, { gain, node })
  }, [ensureAudio])

  const detachAudio = useCallback((id: string) => {
    const entry = mediaGains.current.get(id)
    entry?.gain.disconnect()
    entry?.node.disconnect()
    mediaGains.current.delete(id)
  }, [])

  const setProgramAudio = useCallback((id: string) => {
    programId.current = id
    const context = audio.current?.context
    mediaGains.current.forEach(({ gain }, sourceId) => {
      if (context) gain.gain.setTargetAtTime(sourceId === id ? 1 : 0, context.currentTime, 0.08)
    })
  }, [])

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
      setMessage('Program output is reaching the origin. Press Go live on the Go Live page to put it on air.')
    }

    ws.onclose = (event) => {
      if (socket.current !== ws) return
      const reason = event.reason || (event.code === 1006
        ? 'Could not open the output. Another switcher or encoder may already be live, or your studio session expired.'
        : 'The output connection closed.')
      fail(reason)
    }
  }, [canvasRef, ensureAudio, fail])

  const toggleMic = useCallback(async () => {
    if (mic.current) {
      mic.current.node.disconnect()
      mic.current.stream.getTracks().forEach((track) => track.stop())
      mic.current = null
      setMicOn(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const { context, destination } = ensureAudio()
      const node = context.createMediaStreamSource(stream)
      node.connect(destination)
      mic.current = { stream, node }
      setMicOn(true)
    } catch {
      setMessage('Microphone access was blocked or unavailable.')
    }
  }, [ensureAudio])

  useEffect(() => () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    const ws = socket.current
    socket.current = null
    ws?.close(1000)
    mic.current?.stream.getTracks().forEach((track) => track.stop())
    void audio.current?.context.close()
  }, [])

  return { state, message, micOn, start, stop, toggleMic, attachAudio, detachAudio, setProgramAudio }
}
