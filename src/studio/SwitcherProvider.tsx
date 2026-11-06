import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, errorMessage, type Playlist, type ScheduleEntry, type StudioLive } from '../api'
import { createPlaylistPlayer, type PlaylistPlayer } from './playlistPlayer'
import { DEFAULT_PIP, drawProgram, drawSource, OUTPUT_HEIGHT, OUTPUT_WIDTH, type Layout, type LayoutMode, type ProgramScene, type SavedSource, type Source, type Transition } from './programCompositor'
import { useGuestLink, type GuestInfo } from './guestLink'
import { SwitcherContext, type Automation, type AutomationStatus, type SlotChoice, type Switcher } from './switcherContext'
import { useSwitcherOutput } from './useSwitcherOutput'

const STORAGE_KEY = 'ggtv-switcher-v1'
const BARS: Source = { id: 'bars', name: 'COLOR BARS', kind: 'pattern' }

type SavedSetup = {
  sources: { id: string; name: string; saved: SavedSource; owner?: string }[]
  lowerTitle: string
  lowerDetail: string
  ticker: string
  transition: string
  duration: number
  fillPlaylistId: string
  liveSourceId: string
}

const AUTOMATION_OFF: AutomationStatus = { mode: 'off', text: 'The schedule is off. PROGRAM is under manual control.', slotId: null, warning: null }
// Automation sources: the fill playlist is keyed by playlist so changing it starts the new one.
const fillSourceId = (playlistId: string) => `auto-fill-${playlistId}`
const slotSourceId = (slotId: string) => `auto-slot-${slotId}`
const breakSourceId = (breakId: string) => `auto-break-${breakId}`

// The switcher setup is remembered in this browser; media itself can't be, so saved
// sources come back offline and are reconnected (cameras automatically when allowed).
function readSetup(): SavedSetup {
  const fallback: SavedSetup = {
    sources: [], lowerTitle: 'LIVE FROM GGTV', lowerDetail: 'Broadcast control room', ticker: 'WELCOME TO GGTV LIVE',
    transition: 'CUT', duration: 350, fillPlaylistId: '', liveSourceId: '',
  }
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return stored ? { ...fallback, ...stored, sources: Array.isArray(stored.sources) ? stored.sources : [] } : fallback
  } catch {
    return fallback
  }
}

function kindOf(saved: SavedSource): Source['kind'] {
  return saved.kind === 'playlist' ? 'media' : saved.kind
}

function imageFrom(dataUrl: string) {
  const image = new Image()
  image.src = dataUrl
  return image
}

// Shrinks a chosen picture to at most 1280×720 so it can be saved with the switcher setup.
async function readImage(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, OUTPUT_WIDTH / bitmap.width, OUTPUT_HEIGHT / bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/webp', 0.88)
}

const guestSourceId = (guestId: string) => `guest-${guestId}`
const isGuestSource = (id: string | null) => Boolean(id?.startsWith('guest-'))

// Guests are gone after a reload, so a saved layout keeps their screens empty for the next guest.
function savedLayout(layout: Layout): SavedSource {
  return { kind: 'layout', layout: { ...layout, slots: layout.slots.map((id) => isGuestSource(id) ? null : id) as Layout['slots'] } }
}

// Puts a guest into the first empty layout screen: the layout on PROGRAM first, then PREVIEW, then any other.
function placeGuest(sources: Source[], guestId: string, preferred: string[]) {
  if (sources.some((source) => source.layout?.slots.includes(guestId))) return sources
  const layouts = sources.filter((source) => source.layout?.slots.includes(null))
  const target = preferred.map((id) => layouts.find((source) => source.id === id)).find(Boolean) ?? layouts[0]
  if (!target?.layout) return sources
  const slots = [...target.layout.slots] as Layout['slots']
  slots[slots.indexOf(null)] = guestId
  return sources.map((source) => source === target ? { ...source, layout: { ...target.layout!, slots } } : source)
}

// Clears a removed source out of every layout, leaving its screen empty for the next guest.
function clearFromLayouts(sources: Source[], id: string) {
  return sources.map((source) => source.layout?.slots.includes(id)
    ? { ...source, layout: { ...source.layout, slots: source.layout.slots.map((slot) => slot === id ? null : slot) as Layout['slots'] } }
    : source)
}

// Screen captures include sound: a shared tab's, or the whole computer's where the browser offers
// it. Processing meant for voices is turned off so music and video sound go out as they are.
function captureScreen() {
  return navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include',
  } as DisplayMediaStreamOptions)
}

function createProgramCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_WIDTH
  canvas.height = OUTPUT_HEIGHT
  canvas.setAttribute('aria-label', 'Program output')
  return canvas
}

function SwitcherProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(readSetup)
  const [sources, setSources] = useState<Source[]>(() => [
    BARS,
    ...initial.sources.map(({ id, name, saved, owner }): Source => saved.kind === 'layout'
      ? { id, name, kind: 'layout', layout: { ...saved.layout, pip: { ...DEFAULT_PIP, ...saved.layout.pip } } }
      : saved.kind === 'image'
        ? { id, name, kind: 'image', image: imageFrom(saved.dataUrl), saved, owner }
        : { id, name, kind: kindOf(saved), saved, offline: true, owner }),
  ])
  const [previewId, setPreviewId] = useState('bars')
  const [programId, setProgramId] = useState('bars')
  const [transition, setTransition] = useState(initial.transition)
  const [duration, setDuration] = useState(initial.duration)
  const [isBlack, setIsBlack] = useState(false)
  const [lowerTitle, setLowerTitle] = useState(initial.lowerTitle)
  const [lowerDetail, setLowerDetail] = useState(initial.lowerDetail)
  const [ticker, setTicker] = useState(initial.ticker)
  const [lowerOnAir, setLowerOnAir] = useState(false)
  const [tickerOnAir, setTickerOnAir] = useState(false)
  const [message, setMessage] = useState('Load a source to preview, then TAKE it to program.')
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [playerStatus, setPlayerStatus] = useState<Record<string, { text: string; isError?: boolean }>>({})
  const [live, setLive] = useState<StudioLive | null>(null)
  const [liveBusy, setLiveBusy] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([])
  // Automation always starts off after a reload; the operator turns it on deliberately.
  const [automation, setAutomationState] = useState<Automation>({ on: false, fillPlaylistId: initial.fillPlaylistId, liveSourceId: initial.liveSourceId })
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus>(AUTOMATION_OFF)
  const automationTick = useRef<() => void>(() => undefined)
  // Breaks that have played all their videos (a break runs until done, not until a clock time).
  const finishedBreaks = useRef(new Set<string>())

  const [programCanvas] = useState(createProgramCanvas)
  const canvasRef = useRef<HTMLCanvasElement | null>(programCanvas)
  const output = useSwitcherOutput(canvasRef)
  const { attachAudio, detachAudio, setProgramAudio, talkbackTrack } = output
  const streams = useRef(new Map<string, MediaStream>())
  const videos = useRef(new Map<string, HTMLVideoElement>())
  const players = useRef(new Map<string, PlaylistPlayer>())
  const scene = useRef<ProgramScene | null>(null)
  const activeTransition = useRef<Transition | null>(null)

  const previewSource = sources.find((source) => source.id === previewId) ?? BARS
  const programSource = sources.find((source) => source.id === programId) ?? BARS
  // Read by the frame clock and by callbacks that run outside React updates.
  const latest = useRef({ sources, previewId, programId })
  useEffect(() => {
    latest.current = { sources, previewId, programId }
  })
  const resolve = useCallback((id: string) => latest.current.sources.find((source) => source.id === id), [])

  useEffect(() => {
    scene.current = {
      source: programSource,
      lowerThird: lowerOnAir ? { title: lowerTitle, detail: lowerDetail } : null,
      ticker: tickerOnAir ? ticker : '',
      black: isBlack,
    }
  })

  useEffect(() => {
    const context = programCanvas.getContext('2d')
    if (!context) return
    // The frame clock runs in a worker: Chrome slows page timers in background tabs to about
    // once a second (once a minute after 5 minutes), but leaves worker timers alone, so
    // PROGRAM keeps drawing at full rate while the operator uses other tabs.
    const clockUrl = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${1000 / 30})`], { type: 'text/javascript' }))
    const clock = new Worker(clockUrl)
    let ticks = 0
    clock.onmessage = () => {
      if (scene.current) drawProgram(context, scene.current, activeTransition.current, videos.current, performance.now(), resolve)
      // Schedule automation checks once a second on the same unthrottled clock.
      ticks = (ticks + 1) % 30
      if (ticks === 0) automationTick.current()
    }
    return () => {
      clock.terminate()
      URL.revokeObjectURL(clockUrl)
    }
  }, [programCanvas, resolve])

  // Closing or reloading the tab is the one thing that always stops the broadcast, so ask first.
  const onAir = output.state === 'streaming' || Boolean(live?.isLive)
  useEffect(() => {
    if (!onAir) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [onAir])

  useEffect(() => {
    try {
      const setup: SavedSetup = {
        sources: sources.flatMap((source) => source.layout
          ? [{ id: source.id, name: source.name, saved: savedLayout(source.layout) }]
          : source.saved ? [{ id: source.id, name: source.name, saved: source.saved, owner: source.owner }] : []),
        lowerTitle,
        lowerDetail,
        ticker,
        transition,
        duration,
        fillPlaylistId: automation.fillPlaylistId,
        liveSourceId: automation.liveSourceId,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(setup))
    } catch {
      // Storage can be unavailable (private windows); the switcher still works without it.
    }
  }, [sources, lowerTitle, lowerDetail, ticker, transition, duration, automation.fillPlaylistId, automation.liveSourceId])

  // Playlists and the schedule are edited on their own tabs; pick up changes regularly.
  useEffect(() => {
    const refresh = () => {
      api<Playlist[]>('/studio/playlists').then(setPlaylists).catch(() => undefined)
      api<ScheduleEntry[]>('/studio/schedule').then(setSchedule).catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(refresh, 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const refresh = () => api<StudioLive>('/studio/live').then(setLive).catch(() => undefined)
    void refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [])

  // Everything on PROGRAM is heard: the source itself, or each source in a layout.
  const audibleKey = (programSource.layout ? programSource.layout.slots.filter(Boolean) : [programId]).join(',')
  useEffect(() => {
    setProgramAudio(audibleKey.split(','))
  }, [audibleKey, setProgramAudio])

  useEffect(() => {
    const ownedStreams = streams.current
    const ownedVideos = videos.current
    const ownedPlayers = players.current
    return () => {
      ownedStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()))
      ownedVideos.forEach((video) => { video.srcObject = null })
      ownedPlayers.forEach((player) => player.destroy())
    }
  }, [])

  // Stops whatever a source is playing and forgets its media (the source itself may stay, offline).
  const release = useCallback((id: string) => {
    streams.current.get(id)?.getTracks().forEach((track) => track.stop())
    streams.current.delete(id)
    players.current.get(id)?.destroy()
    players.current.delete(id)
    const video = videos.current.get(id)
    if (video) video.srcObject = null
    videos.current.delete(id)
    detachAudio(id)
  }, [detachAudio])

  const goOffline = useCallback((id: string) => {
    release(id)
    setSources((current) => current.map((source) => source.id === id
      ? { id: source.id, name: source.name, kind: source.kind, saved: source.saved, offline: true }
      : source))
  }, [release])

  // Puts a captured stream on a source; the program canvas draws it from a muted video element,
  // and its sound (a shared tab or screen's) goes into the program mix.
  const attachStream = useCallback((id: string, stream: MediaStream, options: { monitor?: boolean } = {}) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    void video.play().catch(() => undefined)
    videos.current.set(id, video)
    streams.current.set(id, stream)
    if (stream.getAudioTracks().length) attachAudio(id, stream, options)
    // When the camera is unplugged or "Stop sharing" is clicked, show the source as offline.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => goOffline(id))
  }, [attachAudio, goOffline])

  const startPlaylist = useCallback((id: string, playlist: Playlist, options?: { loop?: boolean; onFinished?: () => void }) => {
    const player = createPlaylistPlayer(playlist, (text, isError) => {
      setPlayerStatus((current) => ({ ...current, [id]: { text, isError } }))
    }, options)
    players.current.set(id, player)
    videos.current.set(id, player.video)
    attachAudio(id, player.video)
    return player.video
  }, [attachAudio])

  const connect = useCallback(async (source: Source) => {
    const saved = source.saved
    if (!saved || saved.kind === 'layout' || saved.kind === 'image') return
    try {
      if (saved.kind === 'playlist') {
        const playlist = (await api<Playlist[]>('/studio/playlists')).find((item) => item.id === saved.playlistId)
        if (!playlist) throw new Error('That playlist no longer exists.')
        const element = startPlaylist(source.id, playlist)
        setSources((current) => current.map((item) => item.id === source.id ? { ...item, element, offline: false } : item))
      } else {
        const stream = saved.kind === 'camera'
          ? await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: saved.deviceId }, width: 1280, height: 720 }, audio: false })
          : await captureScreen()
        attachStream(source.id, stream)
        setSources((current) => current.map((item) => item.id === source.id ? { ...item, stream, offline: false } : item))
      }
      setMessage(`${source.name} reconnected.`)
    } catch (caught) {
      setMessage(`${source.name} could not reconnect: ${caught instanceof Error ? caught.message : 'unavailable'}`)
    }
  }, [attachStream, startPlaylist])

  // Cameras that were already allowed come back without asking; others wait for a click.
  useEffect(() => {
    const cameras = initial.sources.filter((source) => source.saved.kind === 'camera')
    if (!cameras.length) return
    navigator.permissions?.query({ name: 'camera' as PermissionName })
      .then((permission) => {
        if (permission.state !== 'granted') return
        cameras.forEach(({ id, name, saved }) => void connect({ id, name, kind: 'camera', saved, offline: true }))
      })
      .catch(() => undefined)
  }, [initial, connect])

  const selectPreview = useCallback((source: Source) => {
    if (source.offline) {
      void connect(source)
      setPreviewId(source.id)
      return
    }
    setPreviewId(source.id)
    setMessage(`${source.name} loaded to preview.`)
  }, [connect])

  const reconnectAll = useCallback(async () => {
    for (const source of sources.filter((item) => item.offline)) await connect(source)
  }, [sources, connect])

  const addCapture = useCallback(async (kind: 'camera' | 'screen') => {
    try {
      const stream = kind === 'camera'
        ? await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
        : await captureScreen()
      const track = stream.getVideoTracks()[0]
      const id = `${kind}-${Date.now()}`
      const label = track?.label.replace(/\s*\([^)]*\)\s*$/, '').toUpperCase().slice(0, 28)
      const saved: SavedSource = kind === 'camera' ? { kind: 'camera', deviceId: track?.getSettings().deviceId ?? '' } : { kind: 'screen' }
      const source: Source = { id, name: (kind === 'camera' ? label : '') || (kind === 'camera' ? 'CAMERA' : 'SCREEN SHARE'), kind, stream, saved }
      attachStream(id, stream)
      setSources((current) => [...current, source])
      setPreviewId(id)
      setMessage(kind === 'screen' && !stream.getAudioTracks().length
        ? `${source.name} added to preview without sound. To include sound, share again and turn on sharing audio in the browser's picker.`
        : `${source.name} added to preview.`)
    } catch {
      setMessage(`${kind === 'camera' ? 'Camera' : 'Screen capture'} was cancelled or unavailable.`)
    }
  }, [attachStream])

  const loadPlaylist = useCallback((playlistId: string) => {
    const playlist = playlists.find((item) => item.id === playlistId)
    if (!playlist) {
      setMessage('Choose a playlist to load.')
      return
    }
    const id = `playlist-${Date.now()}`
    const element = startPlaylist(id, playlist)
    setSources((current) => [...current, { id, name: playlist.name.toUpperCase(), kind: 'media', element, saved: { kind: 'playlist', playlistId } }])
    setPreviewId(id)
    setMessage(`Playlist "${playlist.name}" loaded to preview. TAKE it to put it on program.`)
  }, [playlists, startPlaylist])

  const removeSource = useCallback((source: Source) => {
    // A layout takes the cameras, screens and pictures that belong to it along with it.
    const owned = latest.current.sources.filter((item) => item.owner === source.id).map((item) => item.id)
    ;[source.id, ...owned].forEach(release)
    setSources((current) => clearFromLayouts(current.filter((item) => item.id !== source.id && item.owner !== source.id), source.id))
    setPreviewId((current) => current === source.id ? 'bars' : current)
    setProgramId((current) => current === source.id ? 'bars' : current)
  }, [release])

  // Adds a camera on its own, or a split / corner-screen layout with the camera in the first screen.
  // The other screen waits for a guest (or takes one who is already connected and not placed).
  const addCamera = useCallback(async (deviceId: string, mode: 'full' | LayoutMode) => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: 1280, height: 720 }, audio: false })
    } catch {
      setMessage('The camera was blocked, is in use by another app, or is unplugged.')
      return
    }
    const track = stream.getVideoTracks()[0]
    const cameraId = `camera-${Date.now()}`
    const layoutId = `layout-${Date.now()}`
    const cameraName = track?.label.replace(/\s*\([^)]*\)\s*$/, '').toUpperCase().slice(0, 28) || 'CAMERA'
    const camera: Source = {
      id: cameraId, name: cameraName, kind: 'camera', stream,
      saved: { kind: 'camera', deviceId: track?.getSettings().deviceId ?? '' },
      // In a layout the camera only shows inside the layout, not as a tile of its own.
      ...(mode === 'full' ? {} : { owner: layoutId }),
    }
    attachStream(cameraId, stream)
    if (mode === 'full') {
      setSources((current) => [...current, camera])
      setPreviewId(cameraId)
      setMessage(`${cameraName} added to preview.`)
      return
    }
    setSources((current) => {
      const placed = new Set(current.flatMap((source) => source.layout?.slots ?? []))
      const waitingGuest = current.find((source) => source.kind === 'guest' && !placed.has(source.id))?.id ?? null
      const layout: Source = {
        id: layoutId,
        name: `${mode === 'split' ? 'SPLIT' : 'CORNER'}: ${cameraName}`,
        kind: 'layout',
        layout: { mode, slots: [cameraId, waitingGuest], pip: DEFAULT_PIP },
      }
      return [...current, camera, layout]
    })
    setPreviewId(layoutId)
    setMessage(mode === 'split'
      ? 'Split screen added to preview. The next guest who joins goes into the empty side.'
      : 'Corner screen added to preview. The next guest who joins goes into the corner; drag it to move it.')
  }, [attachStream])

  const updateLayout = useCallback((id: string, patch: Partial<Layout>) => {
    setSources((current) => current.map((source) => source.id === id && source.layout ? { ...source, layout: { ...source.layout, ...patch } } : source))
  }, [])

  // Changes what one screen of a layout shows. A camera, screen share or picture chosen here
  // belongs to the layout; whatever it replaces is removed if it belonged to the layout too.
  const setLayoutSlot = useCallback(async (layoutId: string, slot: 0 | 1, choice: SlotChoice) => {
    let added: Source | null = null
    try {
      if (choice.kind === 'camera' || choice.kind === 'screen') {
        const stream = choice.kind === 'camera'
          ? await navigator.mediaDevices.getUserMedia({ video: { ...(choice.deviceId ? { deviceId: { exact: choice.deviceId } } : {}), width: 1280, height: 720 }, audio: false })
          : await captureScreen()
        const track = stream.getVideoTracks()[0]
        const id = `${choice.kind}-${Date.now()}`
        const label = choice.kind === 'camera' ? track?.label.replace(/\s*\([^)]*\)\s*$/, '').toUpperCase().slice(0, 28) || 'CAMERA' : 'SCREEN SHARE'
        const saved: SavedSource = choice.kind === 'camera' ? { kind: 'camera', deviceId: track?.getSettings().deviceId ?? '' } : { kind: 'screen' }
        attachStream(id, stream)
        added = { id, name: label, kind: choice.kind, stream, saved, owner: layoutId }
      } else if (choice.kind === 'image') {
        const dataUrl = await readImage(choice.file)
        added = { id: `image-${Date.now()}`, name: choice.file.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 28) || 'IMAGE', kind: 'image', image: imageFrom(dataUrl), saved: { kind: 'image', dataUrl }, owner: layoutId }
      }
    } catch (caught) {
      setMessage(choice.kind === 'image'
        ? `The picture could not be used: ${caught instanceof Error ? caught.message : 'unreadable file'}`
        : `${choice.kind === 'camera' ? 'The camera' : 'Screen sharing'} was cancelled, blocked or unavailable.`)
      return
    }
    const nextId = added ? added.id : choice.kind === 'source' ? choice.id : null
    const layout = latest.current.sources.find((source) => source.id === layoutId)?.layout
    if (!layout) return
    const previous = layout.slots[slot]
    const otherSlot = layout.slots[slot === 0 ? 1 : 0]
    const dropPrevious = previous !== null && previous !== otherSlot
      && latest.current.sources.find((source) => source.id === previous)?.owner === layoutId
    if (dropPrevious) release(previous)
    setSources((current) => {
      let next = added ? [...current, added] : current
      if (dropPrevious) next = next.filter((source) => source.id !== previous)
      // A source can only be in one screen of a layout at a time.
      return next.map((source) => {
        if (source.id !== layoutId || !source.layout) return source
        const slots = [...source.layout.slots] as Layout['slots']
        if (nextId && slots[slot === 0 ? 1 : 0] === nextId) slots[slot === 0 ? 1 : 0] = null
        slots[slot] = nextId
        return { ...source, layout: { ...source.layout, slots } }
      })
    })
    setMessage(nextId ? `Screen ${slot + 1} now shows ${added?.name ?? latest.current.sources.find((source) => source.id === nextId)?.name ?? 'the chosen source'}.` : `Screen ${slot + 1} is empty and waits for the next guest.`)
  }, [attachStream, release])

  const guestLink = useGuestLink({
    programCanvas,
    talkbackTrack,
    onStream: (guest: GuestInfo, stream: MediaStream) => {
      const id = guestSourceId(guest.guestId)
      attachStream(id, stream, { monitor: true })
      const source: Source = { id, name: `GUEST: ${guest.name.toUpperCase().slice(0, 24)}`, kind: 'guest', stream }
      const { programId: onProgram, previewId: onPreview } = latest.current
      setSources((current) => placeGuest([...current.filter((item) => item.id !== id), source], id, [onProgram, onPreview]))
      setMessage(`${guest.name} joined.`)
    },
    onLeft: (guestId: string) => {
      const id = guestSourceId(guestId)
      if (!latest.current.sources.some((source) => source.id === id)) return
      release(id)
      setSources((current) => clearFromLayouts(current.filter((item) => item.id !== id), id))
      setPreviewId((current) => current === id ? 'bars' : current)
      setProgramId((current) => current === id ? 'bars' : current)
      setMessage('A guest left. Their screen is empty until the next guest joins.')
    },
  })

  const drawSourceFrame = useCallback((context: CanvasRenderingContext2D, source: Source) => {
    drawSource(context, source, videos.current, resolve)
  }, [resolve])

  const cutTo = useCallback((targetId: string, from: Source) => {
    activeTransition.current = transition === 'CUT' || duration === 0
      ? null
      : { from, mode: transition, start: performance.now(), duration }
    setProgramId(targetId)
    setIsBlack(false)
  }, [transition, duration])

  const takeProgram = useCallback(() => {
    if (previewId === programId) return
    cutTo(previewId, programSource)
    setMessage(`${transition} to ${previewSource.name}.`)
  }, [previewId, programId, programSource, previewSource, transition, cutTo])

  // Adds an automation-owned playlist source (once) and returns its id.
  const ensurePlaylistSource = useCallback((id: string, playlist: Playlist, label: string, options?: { loop?: boolean; onFinished?: () => void }) => {
    if (!players.current.has(id)) {
      const element = startPlaylist(id, playlist, options)
      setSources((current) => current.some((source) => source.id === id)
        ? current
        : [...current, { id, name: label, kind: 'media', element, auto: true }])
    }
    return id
  }, [startPlaylist])

  const dropAutoSource = useCallback((id: string) => {
    release(id)
    setSources((current) => current.filter((source) => source.id !== id))
  }, [release])

  // Runs once a second while automation is on: decides what PROGRAM should show right now.
  useEffect(() => {
    automationTick.current = () => {
      if (!automation.on) return
      const now = new Date().toISOString()
      const shows = schedule.filter((entry) => entry.kind !== 'break')
      const slot = shows.find((entry) => entry.start <= now && entry.end > now) ?? null
      const next = schedule.find((entry) => entry.start > now) ?? null
      const fill = playlists.find((playlist) => playlist.id === automation.fillPlaylistId) ?? null
      let target: string | null = null
      let mode: AutomationStatus['mode'] = 'idle'
      let warning: string | null = null

      if (slot?.kind === 'playlist') {
        const playlist = playlists.find((item) => item.id === slot.playlistId)
        if (playlist) {
          target = ensurePlaylistSource(slotSourceId(slot.id), playlist, `SCHEDULED: ${slot.title.toUpperCase()}`)
          mode = 'playlist'
        } else warning = `"${slot.title}" uses a playlist that no longer exists.`
      } else if (slot?.kind === 'live') {
        const liveSource = sources.find((source) => source.id === automation.liveSourceId && !source.offline)
        if (liveSource) {
          target = liveSource.id
          mode = 'live'
        } else warning = `"${slot.title}" is a live show, but no live source is chosen or it is offline.`
      }
      if (!target && fill) {
        target = ensurePlaylistSource(fillSourceId(fill.id), fill, `FILL: ${fill.name.toUpperCase()}`)
        mode = 'fill'
      }

      // A break interrupts whatever would be on, plays its videos once, then hands back.
      // Once started it runs until its last video ends; it only starts inside its time window.
      const breaks = schedule.filter((entry) => entry.kind === 'break' && !finishedBreaks.current.has(entry.id))
      const activeBreak = breaks.find((entry) => players.current.has(breakSourceId(entry.id)))
        // A short break may start up to a minute late rather than be missed.
        ?? breaks.find((entry) => entry.start <= now && Date.now() < Math.max(Date.parse(entry.end), Date.parse(entry.start) + 60000)) ?? null
      const resumeLabel = mode === 'live' ? `the live show "${slot!.title}"` : mode === 'playlist' ? `"${slot!.title}"` : mode === 'fill' ? `the fill playlist` : 'PROGRAM'
      if (activeBreak?.items?.length) {
        const breakId = activeBreak.id
        target = ensurePlaylistSource(breakSourceId(breakId), { id: breakId, name: activeBreak.title, items: activeBreak.items, updatedAt: '' }, `BREAK: ${activeBreak.title.toUpperCase()}`, {
          loop: false,
          onFinished: () => {
            finishedBreaks.current.add(breakId)
            automationTick.current()
          },
        })
        mode = 'break'
      }

      // The fill playlist pauses while anything else is on and resumes where it stopped.
      players.current.forEach((player, id) => {
        if (!id.startsWith('auto-')) return
        if (id === target) player.resume()
        else player.pause()
      })
      if (target && target !== programId) {
        cutTo(target, programSource)
      }
      // Clean up finished slots, finished breaks and replaced fill playlists once they are off
      // PROGRAM. The current fill playlist and an unfinished slot are kept (paused) so they resume.
      sources.forEach((source) => {
        if (!source.auto || source.id === target || source.id === programId) return
        let ended = true
        if (source.id.startsWith('auto-slot-')) {
          const slotId = source.id.slice('auto-slot-'.length)
          ended = !schedule.some((entry) => entry.id === slotId && entry.end > now)
        } else if (source.id.startsWith('auto-break-')) {
          const breakId = source.id.slice('auto-break-'.length)
          ended = finishedBreaks.current.has(breakId) || !schedule.some((entry) => entry.id === breakId)
        } else if (source.id.startsWith('auto-fill-')) {
          ended = source.id !== fillSourceId(automation.fillPlaylistId)
        }
        if (ended) dropAutoSource(source.id)
      })

      const until = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      const text = mode === 'break' ? `Break: "${activeBreak!.title}" (${activeBreak!.items!.length} video${activeBreak!.items!.length > 1 ? 's' : ''}), then back to ${resumeLabel}`
        : mode === 'playlist' ? `Scheduled: "${slot!.title}" until ${until(slot!.end)}`
        : mode === 'live' ? `Live show: "${slot!.title}" until ${until(slot!.end)}`
          : mode === 'fill' ? `Fill playlist "${fill!.name}"${next ? ` until "${next.title}" at ${until(next.start)}` : ''}`
            : 'Nothing to play: choose a fill playlist or schedule something.'
      const slotId = mode === 'break' ? activeBreak!.id : slot?.id ?? null
      setAutomationStatus((current) => current.text === text && current.warning === warning && current.slotId === slotId
        ? current
        : { mode, text, slotId, warning })
    }
  })

  const setAutomation = useCallback((patch: Partial<Automation>) => {
    setAutomationState((current) => ({ ...current, ...patch }))
    if (patch.on === false) {
      setAutomationStatus(AUTOMATION_OFF)
      setMessage('Schedule off. PROGRAM stays where it is; use TAKE to switch.')
    } else if (patch.on) {
      setMessage('Schedule on. It switches PROGRAM to scheduled shows, breaks and the fill playlist.')
      // Run straight away instead of waiting for the next one-second check.
      window.setTimeout(() => automationTick.current(), 0)
    }
  }, [])

  const goLive = useCallback(async () => {
    if (!live) return
    if (!live.encoderConnected && !window.confirm('No video is reaching the server yet, so viewers will see an empty player. Go live anyway?')) return
    setLiveBusy(true)
    try {
      setLive(await api<StudioLive>('/studio/live/start', { method: 'POST', body: { title: live.title, description: live.description } }))
      setMessage('You are on air. Viewers on the home page now see PROGRAM.')
    } catch (caught) {
      setMessage(errorMessage(caught))
    } finally {
      setLiveBusy(false)
    }
  }, [live])

  const endBroadcast = useCallback(async () => {
    if (!window.confirm('End the broadcast? Viewers will see the channel as off air.')) return
    setLiveBusy(true)
    try {
      setLive(await api<StudioLive>('/studio/live/stop', { method: 'POST', body: {} }))
      setMessage('Broadcast ended. The output is still running until you stop it.')
    } catch (caught) {
      setMessage(errorMessage(caught))
    } finally {
      setLiveBusy(false)
    }
  }, [])

  const value = useMemo<Switcher>(() => ({
    sources,
    previewSource,
    programSource,
    selectPreview,
    takeProgram,
    transition,
    setTransition,
    duration,
    setDuration,
    isBlack,
    toggleBlack: () => setIsBlack((current) => !current),
    lowerTitle,
    setLowerTitle,
    lowerDetail,
    setLowerDetail,
    ticker,
    setTicker,
    lowerOnAir,
    toggleLower: () => setLowerOnAir((current) => !current),
    tickerOnAir,
    toggleTicker: () => setTickerOnAir((current) => !current),
    message,
    addCapture,
    reconnectAll,
    removeSource,
    playlists,
    loadPlaylist,
    skip: (source) => players.current.get(source.id)?.skip(),
    playerStatus,
    programCanvas,
    output,
    live,
    setLive,
    liveBusy,
    addCamera,
    updateLayout,
    setLayoutSlot,
    drawSourceFrame,
    guests: guestLink.guests,
    guestLinkOpen: guestLink.linkOpen,
    removeGuest: guestLink.removeGuest,
    goLive,
    endBroadcast,
    schedule,
    automation,
    setAutomation,
    automationStatus,
  }), [sources, previewSource, programSource, selectPreview, takeProgram, transition, duration, isBlack, lowerTitle, lowerDetail, ticker,
    lowerOnAir, tickerOnAir, message, addCapture, reconnectAll, removeSource, playlists, loadPlaylist, playerStatus, programCanvas, output,
    live, liveBusy, goLive, endBroadcast, schedule, automation, setAutomation, automationStatus, addCamera, updateLayout, setLayoutSlot, drawSourceFrame,
    guestLink.guests, guestLink.linkOpen, guestLink.removeGuest])

  return <SwitcherContext.Provider value={value}>{children}</SwitcherContext.Provider>
}

export default SwitcherProvider
