export const OUTPUT_WIDTH = 1280
export const OUTPUT_HEIGHT = 720

export type Source = {
  id: string
  name: string
  kind: 'pattern' | 'camera' | 'screen' | 'media'
  stream?: MediaStream
  // A video element the source plays into (loaded playlists).
  element?: HTMLVideoElement
}

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

function drawSlate(ctx: CanvasRenderingContext2D, label: string) {
  ctx.fillStyle = '#17211d'
  ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
  ctx.fillStyle = '#88958f'
  ctx.font = `600 28px ${MONO_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${label} · NO SIGNAL`, OUTPUT_WIDTH / 2, OUTPUT_HEIGHT / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

function drawSource(ctx: CanvasRenderingContext2D, source: Source, videos: Map<string, HTMLVideoElement>) {
  ctx.fillStyle = '#080d0b'
  ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)

  const video = videos.get(source.id)
  if (video && video.readyState >= 2 && video.videoWidth) {
    // Letterbox the source into the 16:9 frame.
    const scale = Math.min(OUTPUT_WIDTH / video.videoWidth, OUTPUT_HEIGHT / video.videoHeight)
    const width = video.videoWidth * scale
    const height = video.videoHeight * scale
    ctx.drawImage(video, (OUTPUT_WIDTH - width) / 2, (OUTPUT_HEIGHT - height) / 2, width, height)
    return
  }
  if (source.kind === 'pattern') drawBars(ctx)
  else drawSlate(ctx, source.name)
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
) {
  const progress = transition ? Math.min(1, (now - transition.start) / transition.duration) : 1

  if (transition && progress < 1) {
    if (transition.mode === 'WIPE') {
      drawSource(ctx, transition.from, videos)
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, OUTPUT_WIDTH * progress, OUTPUT_HEIGHT)
      ctx.clip()
      drawSource(ctx, scene.source, videos)
      ctx.restore()
    } else if (transition.mode === 'FADE') {
      // Dip through black: old source fades out, new source fades in.
      const outgoing = progress < 0.5
      drawSource(ctx, outgoing ? transition.from : scene.source, videos)
      ctx.fillStyle = `rgba(0, 0, 0, ${outgoing ? progress * 2 : (1 - progress) * 2})`
      ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
    } else {
      drawSource(ctx, transition.from, videos)
      ctx.globalAlpha = progress
      drawSource(ctx, scene.source, videos)
      ctx.globalAlpha = 1
    }
  } else {
    drawSource(ctx, scene.source, videos)
  }

  if (scene.lowerThird) drawLowerThird(ctx, scene.lowerThird.title, scene.lowerThird.detail)
  if (scene.ticker) drawTicker(ctx, scene.ticker, now)
  if (scene.black) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT)
  }
}
