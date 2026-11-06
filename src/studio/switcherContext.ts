import { createContext, useContext } from 'react'
import type { Playlist, ScheduleEntry, StudioLive } from '../api'
import type { Layout, LayoutMode, Source } from './programCompositor'
import type { GuestInfo } from './guestLink'
import type { useSwitcherOutput } from './useSwitcherOutput'

export type Switcher = {
  sources: Source[]
  previewSource: Source
  programSource: Source
  selectPreview: (source: Source) => void
  takeProgram: () => void
  transition: string
  setTransition: (mode: string) => void
  duration: number
  setDuration: (ms: number) => void
  isBlack: boolean
  toggleBlack: () => void
  lowerTitle: string
  setLowerTitle: (text: string) => void
  lowerDetail: string
  setLowerDetail: (text: string) => void
  ticker: string
  setTicker: (text: string) => void
  lowerOnAir: boolean
  toggleLower: () => void
  tickerOnAir: boolean
  toggleTicker: () => void
  message: string
  addCapture: (kind: 'camera' | 'screen') => Promise<void>
  reconnectAll: () => Promise<void>
  removeSource: (source: Source) => void
  playlists: Playlist[]
  loadPlaylist: (playlistId: string) => void
  skip: (source: Source) => void
  playerStatus: Record<string, { text: string; isError?: boolean }>
  // The PROGRAM canvas lives as long as the studio, so the output keeps going between pages.
  programCanvas: HTMLCanvasElement
  output: ReturnType<typeof useSwitcherOutput>
  live: StudioLive | null
  setLive: (live: StudioLive) => void
  addCamera: (deviceId: string, mode: 'full' | LayoutMode) => Promise<void>
  updateLayout: (id: string, patch: Partial<Layout>) => void
  setLayoutSlot: (layoutId: string, slot: 0 | 1, choice: SlotChoice) => Promise<void>
  // Draws a source (a layout included) into a 1280×720 canvas context, for previews.
  drawSourceFrame: (context: CanvasRenderingContext2D, source: Source) => void
  guests: GuestInfo[]
  guestLinkOpen: boolean
  removeGuest: (guestId: string) => void
  liveBusy: boolean
  goLive: () => Promise<void>
  endBroadcast: () => Promise<void>
  schedule: ScheduleEntry[]
  automation: Automation
  setAutomation: (patch: Partial<Automation>) => void
  automationStatus: AutomationStatus
}

// What a layout screen can be changed to (right-click on a screen).
export type SlotChoice =
  | { kind: 'camera'; deviceId: string }
  | { kind: 'screen' }
  | { kind: 'image'; file: File }
  | { kind: 'source'; id: string }
  | { kind: 'empty' }

export type Automation = {
  on: boolean
  // Plays whenever no scheduled show is on, and resumes where it paused.
  fillPlaylistId: string
  // The input that scheduled live shows cut to (a camera or screen share).
  liveSourceId: string
}

export type AutomationStatus = {
  mode: 'off' | 'idle' | 'fill' | 'playlist' | 'live' | 'break'
  text: string
  slotId: string | null
  warning: string | null
}

export const SwitcherContext = createContext<Switcher | null>(null)

export function useSwitcher() {
  const switcher = useContext(SwitcherContext)
  if (!switcher) throw new Error('useSwitcher must be used inside SwitcherProvider')
  return switcher
}
