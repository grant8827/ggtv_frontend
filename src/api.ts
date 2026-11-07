export type LiveSource = 'live' | 'playlist' | 'off'

export type LiveStatus = {
  isLive: boolean
  source: LiveSource
  nowPlaying: { slotTitle: string | null; itemTitle: string | null } | null
  title: string
  description: string
  startedAt: string | null
  encoderConnected: boolean
  hlsUrl: string
}

export type PlayoutStatus = {
  state: 'idle' | 'starting' | 'playing' | 'error'
  kind: 'break' | 'slot' | 'fill' | null
  slotTitle: string | null
  playlistName: string | null
  itemTitle: string | null
  error: string | null
}

export type RestreamPlatform = 'youtube' | 'facebook'

export type RestreamStatus = {
  name: string
  serverUrl: string
  streamKeySet: boolean
  // Only the last few characters of the saved key are ever sent back.
  streamKeyHint: string
  state: 'off' | 'connecting' | 'live'
  error: string | null
  startedAt: string | null
}

export type StudioLive = LiveStatus & {
  streamName: string
  streamKey: string
  rtmpUrl: string
  playout: PlayoutStatus
  restream: Record<RestreamPlatform, RestreamStatus>
}

// A break plays its own videos once, interrupting whatever is on, then hands back.
export type ScheduleKind = 'live' | 'playlist' | 'break'

export type ScheduleEntry = {
  id: string
  title: string
  description: string
  start: string
  end: string
  kind: ScheduleKind
  playlistId: string | null
  playlistName?: string | null
  // A break's videos, or a playlist slot's own videos (instead of a saved playlist).
  items?: PlaylistItem[]
  updatedAt?: string
  // Breaks only: how often it plays (null or missing = once).
  repeat?: BreakRepeat | null
  // A repeating break's plays from a day ago to two days ahead, and whether it has none left.
  occurrences?: { start: string; end: string }[]
  finished?: boolean
  // Set on one play of a repeating break: the break it belongs to.
  seriesId?: string
}

export type RepeatFrequency = 'once' | 'daily' | 'weekly' | 'monthly'

// Days and times are in `timeZone`, the studio's time zone when the break was saved.
export type BreakRepeat = {
  frequency: RepeatFrequency
  weekdays: number[] // 0 = Sunday, for weekly breaks
  everyMinutes: number // 0 = once on each day; otherwise again every N minutes…
  untilTime: string | null // …until this time ('HH:MM')
  endDate: string | null // last day ('YYYY-MM-DD'), or null for no end
  timeZone: string
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const clockLabel = (hhmm: string) => {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export const everyLabel = (minutes: number) => minutes % 60 === 0
  ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
  : minutes > 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} minutes`

// e.g. "Every Mon, Fri at 9:00 AM, then every 30 minutes until 5:00 PM, until Dec 31"
export function repeatSummary(repeat: BreakRepeat | null | undefined, start: string) {
  const time = new Date(start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (!repeat || repeat.frequency === 'once') return `Once, ${formatDay(start)} at ${time}`
  const days = repeat.frequency === 'daily' ? 'Every day'
    : repeat.frequency === 'weekly' ? `Every ${repeat.weekdays.map((day) => WEEKDAYS[day]).join(', ')}`
      : `Every month on the ${ordinal(new Date(start).getDate())}`
  const during = repeat.everyMinutes && repeat.untilTime ? `, then every ${everyLabel(repeat.everyMinutes)} until ${clockLabel(repeat.untilTime)}` : ''
  const ends = repeat.endDate ? `, until ${new Date(`${repeat.endDate}T12:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` : ''
  return `${days} at ${time}${during}${ends}`
}

function ordinal(day: number) {
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'
  return `${day}${suffix}`
}

// Turns each repeating break into one entry per play, so automation treats every play like a
// one-off break (each with its own id, played once).
export function expandBreaks(entries: ScheduleEntry[]) {
  return entries
    .flatMap((entry) => entry.occurrences
      ? entry.occurrences.map((time) => ({ ...entry, ...time, id: `${entry.id}@${time.start}`, seriesId: entry.id, occurrences: undefined }))
      : [entry])
    .sort((a, b) => a.start.localeCompare(b.start))
}

export type PlaylistItem = {
  id?: string
  title: string
  // A link to a video, or null for a file stored in a studio browser's IndexedDB (fileId).
  url: string | null
  fileId?: string
  // A video uploaded to the server's media storage.
  mediaId?: string
  fileName?: string
  durationMinutes: number
}

export type MediaFile = {
  id: string
  name: string
  type: string
  size: number
  durationSeconds?: number
  uploadedAt: string
  usedBy: string[]
}

export type MediaLibrary = { items: MediaFile[]; used: number; free: number }


export type Playlist = {
  id: string
  name: string
  items: PlaylistItem[]
  updatedAt: string
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const UNAUTHORIZED_EVENT = 'ggtv:unauthorized'

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'X-GGTV-Studio': '1', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 && path.startsWith('/studio')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`)
  }
  return data as T
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message
  return 'Could not reach the GGTV control API.'
}

// How a schedule entry is labelled in rundowns.
export function describeEntry(entry: ScheduleEntry) {
  if (entry.kind === 'live') return 'LIVE SHOW'
  if (entry.kind === 'break') {
    const repeats = entry.repeat && entry.repeat.frequency !== 'once' ? ` · REPEATS ${entry.repeat.frequency.toUpperCase()}` : ''
    return `BREAK · ${entry.items?.length ?? 0} VIDEO${entry.items?.length === 1 ? '' : 'S'}${repeats}`
  }
  if (entry.items) return `VIDEOS · ${entry.items.length} VIDEO${entry.items.length === 1 ? '' : 'S'} · LOOPING`
  return `PLAYLIST · ${entry.playlistName ?? 'missing'}`
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

// Uploads one video to the server with progress (fetch can't report upload progress).
export function uploadMedia(file: File, onProgress: (fraction: number) => void, durationMinutes = 0) {
  return new Promise<MediaFile>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/studio/media')
    request.setRequestHeader('X-GGTV-Studio', '1')
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name))
    request.setRequestHeader('Content-Type', file.type || 'video/mp4')
    request.setRequestHeader('X-Duration-Seconds', String(Math.round(durationMinutes * 60)))
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total)
    request.onload = () => {
      const data = (() => {
        try {
          return JSON.parse(request.responseText)
        } catch {
          return {}
        }
      })()
      if (request.status === 201) resolve(data as MediaFile)
      else {
        if (request.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
        reject(new ApiError(request.status, data.error ?? `Upload failed (${request.status})`))
      }
    }
    request.onerror = () => reject(new ApiError(0, 'The upload was interrupted. Check your connection and try again.'))
    request.send(file)
  })
}
