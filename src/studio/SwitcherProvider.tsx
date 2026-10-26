import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, errorMessage, type Playlist, type ScheduleEntry, type StudioLive } from '../api'
import { createPlaylistPlayer, type PlaylistPlayer } from './playlistPlayer'
import { drawProgram, OUTPUT_HEIGHT, OUTPUT_WIDTH, type ProgramScene, type SavedSource, type Source, type Transition } from './programCompositor'
import { SwitcherContext, type Automation, type AutomationStatus, type Switcher } from './switcherContext'
import { useSwitcherOutput } from './useSwitcherOutput'

const STORAGE_KEY = 'ggtv-switcher-v1'
const BARS: Source = { id: 'bars', name: 'COLOR BARS', kind: 'pattern' }

type SavedSetup = {
  sources: { id: string; name: string; saved: SavedSource }[]
  lowerTitle: string
  lowerDetail: string
  ticker: string
  transition: string
  duration: number
  fillPlaylistId: string
  liveSourceId: string
}

const AUTOMATION_OFF: AutomationStatus = { mode: 'off', text: 'Automation is off. PROGRAM is under manual control.', slotId: null, warning: null }
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
    ...initial.sources.map(({ id, name, saved }) => ({ id, name, kind: kindOf(saved), saved, offline: true })),
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
  const { attachAudio, detachAudio, setProgramAudio } = output
  const streams = useRef(new Map<string, MediaStream>())
  const videos = useRef(new Map<string, HTMLVideoElement>())
  const players = useRef(new Map<string, PlaylistPlayer>())
  const scene = useRef<ProgramScene | null>(null)
  const activeTransition = useRef<Transition | null>(null)

  const previewSource = sources.find((source) => source.id === previewId) ?? BARS
  const programSource = sources.find((source) => source.id === programId) ?? BARS

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
      if (scene.current) drawProgram(context, scene.current, activeTransition.current, videos.current, performance.now())
      // Schedule automation checks once a second on the same unthrottled clock.
      ticks = (ticks + 1) % 30
      if (ticks === 0) automationTick.current()
    }
    return () => {
      clock.terminate()
      URL.revokeObjectURL(clockUrl)
    }
  }, [programCanvas])

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
        sources: sources.flatMap((source) => source.saved ? [{ id: source.id, name: source.name, saved: source.saved }] : []),
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

  useEffect(() => {
    setProgramAudio(programId)
  }, [programId, setProgramAudio])

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

  // Puts a captured stream on a source; the program canvas draws it from a muted video element.
  const attachStream = useCallback((id: string, stream: MediaStream) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    void video.play().catch(() => undefined)
    videos.current.set(id, video)
    streams.current.set(id, stream)
    // When the camera is unplugged or "Stop sharing" is clicked, show the source as offline.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => goOffline(id))
  }, [goOffline])

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
    if (!saved) return
    try {
      if (saved.kind === 'playlist') {
        const playlist = (await api<Playlist[]>('/studio/playlists')).find((item) => item.id === saved.playlistId)
        if (!playlist) throw new Error('That playlist no longer exists.')
        const element = startPlaylist(source.id, playlist)
        setSources((current) => current.map((item) => item.id === source.id ? { ...item, element, offline: false } : item))
      } else {
        const stream = saved.kind === 'camera'
          ? await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: saved.deviceId }, width: 1280, height: 720 }, audio: false })
          : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
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
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track = stream.getVideoTracks()[0]
      const id = `${kind}-${Date.now()}`
      const label = track?.label.replace(/\s*\([^)]*\)\s*$/, '').toUpperCase().slice(0, 28)
      const saved: SavedSource = kind === 'camera' ? { kind: 'camera', deviceId: track?.getSettings().deviceId ?? '' } : { kind: 'screen' }
      const source: Source = { id, name: (kind === 'camera' ? label : '') || (kind === 'camera' ? 'CAMERA' : 'SCREEN SHARE'), kind, stream, saved }
      attachStream(id, stream)
      setSources((current) => [...current, source])
      setPreviewId(id)
      setMessage(`${source.name} added to preview.`)
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
    release(source.id)
    setSources((current) => current.filter((item) => item.id !== source.id))
    setPreviewId((current) => current === source.id ? 'bars' : current)
    setProgramId((current) => current === source.id ? 'bars' : current)
  }, [release])

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
        ?? breaks.find((entry) => entry.start <= now && entry.end > now) ?? null
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
      setMessage('Automation off. PROGRAM stays where it is; use TAKE to switch.')
    } else if (patch.on) {
      setMessage('Automation on. It switches PROGRAM to the schedule and the fill playlist.')
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
    liveBusy,
    goLive,
    endBroadcast,
    schedule,
    automation,
    setAutomation,
    automationStatus,
  }), [sources, previewSource, programSource, selectPreview, takeProgram, transition, duration, isBlack, lowerTitle, lowerDetail, ticker,
    lowerOnAir, tickerOnAir, message, addCapture, reconnectAll, removeSource, playlists, loadPlaylist, playerStatus, programCanvas, output,
    live, liveBusy, goLive, endBroadcast, schedule, automation, setAutomation, automationStatus])

  return <SwitcherContext.Provider value={value}>{children}</SwitcherContext.Provider>
}

export default SwitcherProvider
