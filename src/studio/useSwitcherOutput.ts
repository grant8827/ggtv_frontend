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

  const ensureAudio = useCallback(() => {
    if (!audio.current) {
      const context = new AudioContext()
      // The destination yields silence until the mic is connected, so the output always has audio.
      audio.current = { context, destination: context.createMediaStreamDestination() }
    }
    return audio.current
  }, [])

  // Each path that ends the output clears `socket` first, so the socket's own close event is ignored.
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

  return { state, message, micOn, start, stop, toggleMic }
}
