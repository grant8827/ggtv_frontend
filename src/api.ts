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
  slotTitle: string | null
  playlistName: string | null
  itemTitle: string | null
  error: string | null
}

export type StudioLive = LiveStatus & {
  streamName: string
  streamKey: string
  rtmpUrl: string
  playout: PlayoutStatus
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
  items?: PlaylistItem[]
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
  if (entry.kind === 'break') return `BREAK · ${entry.items?.length ?? 0} VIDEO${entry.items?.length === 1 ? '' : 'S'}`
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
