import { useCallback, useEffect, useRef, useState } from 'react'

export type GuestInfo = {
  guestId: string
  inviteId: string
  name: string
  joinedAt: string
  state: 'connecting' | 'connected' | 'failed'
}

type Peer = { pc: RTCPeerConnection; pending: RTCIceCandidateInit[] }

type Options = {
  programCanvas: HTMLCanvasElement
  talkbackTrack: () => MediaStreamTrack
  // A guest's camera and mic have arrived.
  onStream: (guest: GuestInfo, stream: MediaStream) => void
  // A guest left or was disconnected.
  onLeft: (guestId: string) => void
}

// The studio side of guest calls. The studio calls each guest that opens their invite link, sends
// them PROGRAM (so they see the show) and the studio mic, and receives their camera and mic.
export function useGuestLink({ programCanvas, talkbackTrack, onStream, onLeft }: Options) {
  const [guests, setGuests] = useState<GuestInfo[]>([])
  const [linkOpen, setLinkOpen] = useState(false)
  const socket = useRef<WebSocket | null>(null)
  const handlers = useRef({ onStream, onLeft })

  useEffect(() => {
    handlers.current = { onStream, onLeft }
  })

  useEffect(() => {
    const peers = new Map<string, Peer>()
    let stopped = false
    let retry = 0
    let iceServers: RTCIceServer[] = []
    let returnVideo: MediaStreamTrack | null = null
    const returnVideoTrack = () => (returnVideo ??= programCanvas.captureStream(15).getVideoTracks()[0])

    const send = (message: unknown) => {
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message))
    }
    const update = (guestId: string, patch: Partial<GuestInfo>) => {
      setGuests((list) => list.map((guest) => guest.guestId === guestId ? { ...guest, ...patch } : guest))
    }
    const leave = (guestId: string) => {
      peers.get(guestId)?.pc.close()
      peers.delete(guestId)
      setGuests((list) => list.filter((guest) => guest.guestId !== guestId))
      handlers.current.onLeft(guestId)
    }

    const call = async (guest: GuestInfo) => {
      const pc = new RTCPeerConnection({ iceServers })
      const peer: Peer = { pc, pending: [] }
      peers.set(guest.guestId, peer)
      // One video and one audio line each way: the guest answers with their camera and mic.
      pc.addTransceiver(returnVideoTrack(), { direction: 'sendrecv' })
      pc.addTransceiver(talkbackTrack(), { direction: 'sendrecv' })
      const remote = new MediaStream()
      let announced = false
      pc.ontrack = (event) => remote.addTrack(event.track)
      pc.onicecandidate = (event) => {
        if (event.candidate) send({ type: 'signal', guestId: guest.guestId, data: { candidate: event.candidate.toJSON() } })
      }
      pc.onconnectionstatechange = () => {
        if (peers.get(guest.guestId) !== peer) return
        if (pc.connectionState === 'connected') {
          update(guest.guestId, { state: 'connected' })
          if (!announced) {
            announced = true
            handlers.current.onStream(guest, remote)
          }
        } else if (pc.connectionState === 'failed') {
          update(guest.guestId, { state: 'failed' })
        }
      }
      await pc.setLocalDescription(await pc.createOffer())
      send({ type: 'signal', guestId: guest.guestId, data: { description: pc.localDescription?.toJSON() } })
    }

    const onSignal = async (guestId: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      const peer = peers.get(guestId)
      if (!peer) return
      try {
        if (data.description) {
          await peer.pc.setRemoteDescription(data.description)
          for (const candidate of peer.pending.splice(0)) await peer.pc.addIceCandidate(candidate)
        } else if (data.candidate) {
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate)
          else peer.pending.push(data.candidate)
        }
      } catch {
        update(guestId, { state: 'failed' })
      }
    }

    const open = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${protocol}://${window.location.host}/api/studio/guests/signal`)
      socket.current = ws
      ws.onopen = () => setLinkOpen(true)
      ws.onmessage = (event) => {
        if (socket.current !== ws || typeof event.data !== 'string') return
        const message = JSON.parse(event.data)
        if (message.type === 'welcome') {
          iceServers = message.iceServers
          const waiting: GuestInfo[] = message.guests.map((guest: GuestInfo) => ({ ...guest, state: 'connecting' }))
          setGuests(waiting)
          waiting.forEach((guest) => void call(guest))
        } else if (message.type === 'guest-joined') {
          const guest: GuestInfo = { guestId: message.guestId, inviteId: message.inviteId, name: message.name, joinedAt: message.joinedAt, state: 'connecting' }
          setGuests((list) => [...list, guest])
          void call(guest)
        } else if (message.type === 'guest-left') {
          leave(message.guestId)
        } else if (message.type === 'signal') {
          void onSignal(message.guestId, message.data)
        }
      }
      ws.onclose = (event) => {
        if (socket.current !== ws) return
        socket.current = null
        setLinkOpen(false)
        // Guests reconnect on their own; the server sends them again in the next welcome.
        ;[...peers.keys()].forEach(leave)
        // 4000: another studio tab took over guests, so don't fight it for the connection.
        if (!stopped && event.code !== 4000) retry = window.setTimeout(open, 3000)
      }
    }

    open()
    return () => {
      stopped = true
      window.clearTimeout(retry)
      const ws = socket.current
      socket.current = null
      ws?.close()
      ;[...peers.keys()].forEach(leave)
      returnVideo?.stop()
    }
  }, [programCanvas, talkbackTrack])

  const removeGuest = useCallback((guestId: string) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'remove', guestId }))
  }, [])

  return { guests, linkOpen, removeGuest }
}
