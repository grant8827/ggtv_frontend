export type LiveStatus = {
  isLive: boolean
  title: string
  description: string
  startedAt: string | null
  encoderConnected: boolean
  hlsUrl: string
}

export type StudioLive = LiveStatus & {
  streamName: string
  streamKey: string
  rtmpUrl: string
}

export type ScheduleKind = 'live' | 'playlist'

export type ScheduleEntry = {
  id: string
  title: string
  description: string
  start: string
  end: string
  kind: ScheduleKind
  playlistId: string | null
  playlistName?: string | null
}

export type PlaylistItem = {
  id?: string
  title: string
  url: string
  durationMinutes: number
}

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

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}
