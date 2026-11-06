export const OUTPUT_WIDTH = 1280
export const OUTPUT_HEIGHT = 720

export type Source = {
  id: string
  name: string
  kind: 'pattern' | 'camera' | 'screen' | 'media' | 'guest' | 'layout' | 'image'
  stream?: MediaStream
  // A still picture (image sources).
  image?: HTMLImageElement
  // The layout this source belongs to. It lives only inside that layout's screen, so it has no
  // tile of its own in the input bank and is removed with the layout.
  owner?: string
  // A video element the source plays into (loaded playlists).
  element?: HTMLVideoElement
  // What to reconnect after a reload; saved sources start offline until reconnected.
  saved?: SavedSource
  offline?: boolean
  // Added and removed by schedule automation rather than by the operator.
  auto?: boolean
  // A layout shows other sources together; an empty slot waits for the next guest to join.
  layout?: Layout
}

export type LayoutMode = 'split' | 'pip'

export type Layout = {
  mode: LayoutMode
  // split: [left, right]. pip: [main, corner]. null is an empty screen waiting for a guest.
  slots: [string | null, string | null]
  // The corner screen's position and width, as fractions of the frame.
  pip: { x: number; y: number; width: number }
}

export const DEFAULT_PIP = { x: 0.69, y: 0.05, width: 0.28 }

// Where each slot of a layout is drawn, in output pixels.
export function layoutRects(layout: Layout) {
  if (layout.mode === 'split') {
    const half = OUTPUT_WIDTH / 2
    return [{ x: 0, y: 0, width: half, height: OUTPUT_HEIGHT }, { x: half, y: 0, width: half, height: OUTPUT_HEIGHT }]
  }
  const width = layout.pip.width * OUTPUT_WIDTH
  const height = width * 9 / 16
  return [
    { x: 0, y: 0, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT },
    { x: layout.pip.x * OUTPUT_WIDTH, y: layout.pip.y * OUTPUT_HEIGHT, width, height },
  ]
}

type Rect = { x: number; y: number; width: number; height: number }
export type Resolve = (id: string) => Source | undefined

export type SavedSource =
  | { kind: 'camera'; deviceId: string }
  | { kind: 'screen' }
  | { kind: 'playlist'; playlistId: string }
  | { kind: 'layout'; layout: Layout }
  | { kind: 'image'; dataUrl: string }

export type ProgramScene = {
  source: Source
  lowerThird: { title: string; detail: string } | null
  ticker: string
  black: boolean
}

export type Transition = {
  from: Source
  mode: string
  start: number
  duration: number
}

const BAR_COLORS = ['#f4f4ed', '#e7d44f', '#54ba85', '#45a8c7', '#505ec6', '#b84b9d', '#dc6047']
const STRIP_COLORS = ['#161a1b', '#dddddd', '#343a37', '#222222', '#111111']
const SIGNAL = '#ff7045'
const DISPLAY_FONT = '"Barlow Condensed", "Arial Narrow", sans-serif'
const MONO_FONT = '"IBM Plex Mono", monospace'

function drawBars(ctx: CanvasRenderingContext2D) {
  const width = OUTPUT_WIDTH / BAR_COLORS.length
  BAR_COLORS.forEach((color, index) => {
    ctx.fillStyle = color
    ctx.fillRect(index * width, 0, width + 1, OUTPUT_HEIGHT * 0.66)
  })
  const stripWidth = OUTPUT_WIDTH / STRIP_COLORS.length
  STRIP_COLORS.forEach((color, index) => {
    ctx.fillStyle = color
    ctx.fillRect(index * stripWidth, OUTPUT_HEIGHT * 0.66, stripWidth + 1, OUTPUT_HEIGHT * 0.34)
  })
}

function drawSlate(ctx: CanvasRenderingContext2D, label: string, rect: Rect = FULL, text = 'NO SIGNAL') {
  ctx.fillStyle = '#17211d'
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.fillStyle = '#88958f'
  const size = Math.max(14, Math.round(28 * Math.min(1, rect.width / OUTPUT_WIDTH * 1.6)))
  ctx.font = `600 ${size}px ${MONO_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label ? `${label} · ${text}` : text, rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width - 24)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

const FULL: Rect = { x: 0, y: 0, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT }

// Draws a video into a rect: letterboxed when it fills the frame, cropped to fill a layout screen.
function drawPicture(ctx: CanvasRenderingContext2D, picture: CanvasImageSource, pictureWidth: number, pictureHeight: number, rect: Rect, cover: boolean) {
  const fit = cover ? Math.max : Math.min
  const scale = fit(rect.width / pictureWidth, rect.height / pictureHeight)
  const width = pictureWidth * scale
  const height = pictureHeight * scale
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()
  ctx.drawImage(picture, rect.x + (rect.width - width) / 2, rect.y + (rect.height - height) / 2, width, height)
  ctx.restore()
}

function drawInto(ctx: CanvasRenderingContext2D, source: Source, rect: Rect, cover: boolean, videos: Map<string, HTMLVideoElement>) {
  ctx.fillStyle = '#080d0b'
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  const video = videos.get(source.id)
  const image = source.image
  if (video && video.readyState >= 2 && video.videoWidth) drawPicture(ctx, video, video.videoWidth, video.videoHeight, rect, cover)
  // Pictures (logos, slides) always show whole; video is cropped to fill a layout screen.
  else if (image?.complete && image.naturalWidth) drawPicture(ctx, image, image.naturalWidth, image.naturalHeight, rect, false)
  else if (source.kind === 'pattern' && rect === FULL) drawBars(ctx)
  else drawSlate(ctx, source.name, rect)
}

function drawLayout(ctx: CanvasRenderingContext2D, layout: Layout, videos: Map<string, HTMLVideoElement>, resolve: Resolve) {
  const rects = layoutRects(layout)
  layout.slots.forEach((id, index) => {
    const rect = rects[index]
    const slotSource = id ? resolve(id) : undefined
    if (slotSource && slotSource.kind !== 'layout') drawInto(ctx, slotSource, rect, layout.mode === 'split' || index === 1, videos)
    else drawSlate(ctx, '', rect, id ? 'SOURCE REMOVED' : 'WAITING FOR GUEST')
    if (layout.mode === 'pip' && index === 1) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.lineWidth = 3
      ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.width - 3, rect.height - 3)
    }
  })
  if (layout.mode === 'split') {
    ctx.fillStyle = '#080d0b'
    ctx.fillRect(OUTPUT_WIDTH / 2 - 2, 0, 4, OUTPUT_HEIGHT)
  }
}

// Draws one source filling the whole frame (a layout draws the sources it holds).
export function drawSource(ctx: CanvasRenderingContext2D, source: Source, videos: Map<string, HTMLVideoElement>, resolve: Resolve) {
  if (source.layout) drawLayout(ctx, source.layout, videos, resolve)
  else drawInto(ctx, source, FULL, false, videos)
}

function drawLowerThird(ctx: CanvasRenderingContext2D, title: string, detail: string) {
  const height = 96
  const top = OUTPUT_HEIGHT * 0.83 - height
  const gradient = ctx.createLinearGradient(0, 0, OUTPUT_WIDTH, 0)
  gradient.addColorStop(0, 'rgba(19, 43, 38, 0.95)')
  gradient.addColorStop(0.75, 'rgba(19, 43, 38, 0.72)')
  gradient.addColorStop(1, 'rgba(19, 43, 38, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, top, OUTPUT_WIDTH, height)
  ctx.fillStyle = SIGNAL
  ctx.fillRect(0, top, 8, height)

  ctx.fillStyle = '#ffffff'
  ctx.font = `700 40px ${DISPLAY_FONT}`
  ctx.fillText(title, 40, top + 46)
  ctx.fillStyle = '#c6d4ce'
  ctx.font = `500 22px ${MONO_FONT}`
  ctx.fillText(detail, 40, top + 78)
}

function drawTicker(ctx: CanvasRenderingContext2D, text: string, now: number) {
  const height = 44
  const top = OUTPUT_HEIGHT - height
  ctx.fillStyle = SIGNAL
  ctx.fillRect(0, top, OUTPUT_WIDTH, height)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, top, OUTPUT_WIDTH, height)
  ctx.clip()
  ctx.fillStyle = '#17211d'
  ctx.font = `700 22px ${MONO_FONT}`
  const textWidth = ctx.measureText(text).width
  const travel = OUTPUT_WIDTH + textWidth
  const x = OUTPUT_WIDTH - ((now / 1000) * 140) % travel
  ctx.fillText(text, x, top + 30)
  ctx.restore()
}

// Draws one frame of the program output. What this draws is exactly what the output sends.
export function drawProgram(
  ctx: CanvasRenderingContext2D,
  scene: ProgramScene,
  transition: Transition | null,
  videos: Map<string, HTMLVideoElement>,
  now: number,
  resolve: Resolve,
) {
  const progress = transition ? Math.min(1, (now - transition.start) / transition.duration) : 1

  if (transition && progress < 1) {
    if (transition.mode === 'WIPE') {
      drawSource(ctx, transition.from, videos, resolve)
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, OUTPUT_WIDTH * progress, OUTPUT_HEIGHT)
      ctx.clip()
      drawSource(ctx, scene.source, videos, resolve)
      ctx.restore()
    } else if (transition.mode === 'FADE') {
      // Dip through black: old source fades out, new source fades in.
      const outgoing = progress < 0.5
      drawSource(ctx, outgoing ? transition.from : scene.source, videos, resolve)
      ctx.fillStyle = `rgba(0, 0, 0, ${outgoing ? progress * 2 : (1 - progress) * 2})`
      ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    } else {
      drawSource(ctx, transition.from, videos, resolve)
      ctx.globalAlpha = progress
      drawSource(ctx, scene.source, videos, resolve)
      ctx.globalAlpha = 1
    }
  } else {
    drawSource(ctx, scene.source, videos, resolve)
  }

  if (scene.lowerThird) drawLowerThird(ctx, scene.lowerThird.title, scene.lowerThird.detail)
  if (scene.ticker) drawTicker(ctx, scene.ticker, now)
  if (scene.black) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
  }
}
