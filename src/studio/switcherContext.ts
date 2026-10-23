import { createContext, useContext } from 'react'
import type { Playlist, StudioLive } from '../api'
import type { Source } from './programCompositor'
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
  liveBusy: boolean
  goLive: () => Promise<void>
  endBroadcast: () => Promise<void>
}

export const SwitcherContext = createContext<Switcher | null>(null)

export function useSwitcher() {
  const switcher = useContext(SwitcherContext)
  if (!switcher) throw new Error('useSwitcher must be used inside SwitcherProvider')
  return switcher
}
