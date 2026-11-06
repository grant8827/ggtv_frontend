import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, Camera, Columns2, ImageIcon, Maximize, MonitorUp, PictureInPicture2, Plus, UserRound, Video } from 'lucide-react'
import { OUTPUT_HEIGHT, OUTPUT_WIDTH, type LayoutMode, type Source } from './programCompositor'
import { Popover } from './Popover'
import { usePopover } from './usePopover'
import { useSwitcher } from './switcherContext'

// Draws a layout source for the PREVIEW monitor (PROGRAM already has its own canvas).
export function LayoutCanvas({ source }: { source: Source }) {
  const { drawSourceFrame } = useSwitcher()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const current = useRef(source)

  useEffect(() => {
    current.current = source
  })

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    context.setTransform(640 / OUTPUT_WIDTH, 0, 0, 360 / OUTPUT_HEIGHT, 0, 0)
    const timer = window.setInterval(() => drawSourceFrame(context, current.current), 1000 / 15)
    return () => window.clearInterval(timer)
  }, [drawSourceFrame])

  return <canvas ref={canvasRef} width={640} height={360} aria-label={`${source.name} layout`} />
}

const PIP_SIZES = [{ label: 'S', width: 0.22 }, { label: 'M', width: 0.28 }, { label: 'L', width: 0.36 }]
const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max)

// Sits over a monitor showing a layout: drag the corner screen to move it, swap the screens,
// switch between split and corner, and resize the corner screen.
export function LayoutOverlay({ source }: { source: Source }) {
  const { updateLayout } = useSwitcher()
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)
  const layout = source.layout
  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState<{ slot: 0 | 1; x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!layout) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { startX: event.clientX, startY: event.clientY, x: layout.pip.x, y: layout.pip.y }
    setDragging(true)
  }, [layout])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const box = frame.current?.getBoundingClientRect()
    if (!drag.current || !box || !layout) return
    const width = layout.pip.width
    // In a 16:9 frame the corner screen's height, as a fraction, equals its width fraction.
    const x = clamp(drag.current.x + (event.clientX - drag.current.startX) / box.width, 1 - width)
    const y = clamp(drag.current.y + (event.clientY - drag.current.startY) / box.height, 1 - width)
    updateLayout(source.id, { pip: { ...layout.pip, x, y } })
  }, [layout, source.id, updateLayout])

  const endDrag = useCallback(() => {
    drag.current = null
    setDragging(false)
  }, [])

  if (!layout) return null
  const { pip } = layout

  function openMenu(event: ReactMouseEvent, slot: 0 | 1) {
    event.preventDefault()
    setMenu({ slot, x: event.clientX, y: event.clientY })
  }

  const setMode = (mode: LayoutMode) => updateLayout(source.id, { mode })
  const swap = () => updateLayout(source.id, { slots: [layout.slots[1], layout.slots[0]] })
  const resize = (width: number) => updateLayout(source.id, {
    pip: { width, x: clamp(pip.x, 1 - width), y: clamp(pip.y, 1 - width) },
  })

  return (
    <div className="layout-overlay" ref={frame}>
      {/* Right-click a screen to change what it shows. */}
      {layout.mode === 'split' ? (
        <>
          <div className="slot-area" style={{ left: 0, top: 0, width: '50%', height: '100%' }} onContextMenu={(event) => openMenu(event, 0)} title="Right-click to change this screen" />
          <div className="slot-area" style={{ left: '50%', top: 0, width: '50%', height: '100%' }} onContextMenu={(event) => openMenu(event, 1)} title="Right-click to change this screen" />
        </>
      ) : (
        <div className="slot-area" style={{ inset: 0 }} onContextMenu={(event) => openMenu(event, 0)} title="Right-click to change the main screen" />
      )}
      {layout.mode === 'pip' && (
        <div
          className={dragging ? 'pip-handle dragging' : 'pip-handle'}
          style={{ left: `${pip.x * 100}%`, top: `${pip.y * 100}%`, width: `${pip.width * 100}%`, height: `${pip.width * 100}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onContextMenu={(event) => openMenu(event, 1)}
          title="Drag to move the corner screen. Right-click to change it."
          role="slider"
          aria-label="Corner screen position"
          aria-valuetext={`${Math.round(pip.x * 100)}% across, ${Math.round(pip.y * 100)}% down`}
        />
      )}
      <div className="layout-toolbar">
        <button type="button" className={layout.mode === 'split' ? 'selected' : ''} onClick={() => setMode('split')} title="Split screen"><Columns2 size={12} /></button>
        <button type="button" className={layout.mode === 'pip' ? 'selected' : ''} onClick={() => setMode('pip')} title="Corner screen"><PictureInPicture2 size={12} /></button>
        <button type="button" onClick={swap} title="Swap the two screens"><ArrowLeftRight size={12} /></button>
        {layout.mode === 'pip' && PIP_SIZES.map((size) => (
          <button key={size.label} type="button" className={Math.abs(pip.width - size.width) < 0.01 ? 'selected' : ''} onClick={() => resize(size.width)} title={`Corner screen size ${size.label}`}>{size.label}</button>
        ))}
      </div>
      {menu && <SlotMenu layoutId={source.id} slot={menu.slot} x={menu.x} y={menu.y} onClose={closeMenu} />}
    </div>
  )
}

// A small live picture of a guest's camera, so the operator can tell guests apart in the menu.
function GuestThumb({ stream }: { stream?: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video || !stream) return
    video.srcObject = stream
    void video.play().catch(() => undefined)
    return () => {
      video.srcObject = null
    }
  }, [stream])
  return <video className="guest-thumb" ref={ref} autoPlay muted playsInline aria-hidden="true" />
}

// The right-click menu for one layout screen: a camera, a picture, a screen share, a guest, or empty.
function SlotMenu({ layoutId, slot, x, y, onClose }: { layoutId: string; slot: 0 | 1; x: number; y: number; onClose: () => void }) {
  const { sources, setLayoutSlot } = useSwitcher()
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const layout = sources.find((source) => source.id === layoutId)?.layout
  const current = layout?.slots[slot] ?? null
  const guests = sources.filter((source) => source.kind === 'guest')
  const shared = sources.filter((source) => !source.owner && !source.layout && !source.auto && source.kind !== 'guest' && source.kind !== 'pattern' && !source.offline)

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices()
      .then((all) => setCameras(all.filter((device) => device.kind === 'videoinput')))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const choose = (choice: Parameters<typeof setLayoutSlot>[2]) => {
    onClose()
    void setLayoutSlot(layoutId, slot, choice)
  }

  // Keep the menu on screen near where it was opened.
  const left = Math.max(8, Math.min(x, window.innerWidth - 248))
  const top = Math.max(8, Math.min(y, window.innerHeight - 420))
  const title = layout?.mode === 'pip' ? (slot === 0 ? 'Main screen' : 'Corner screen') : slot === 0 ? 'Left screen' : 'Right screen'

  return createPortal(
    <div className="slot-menu" ref={menuRef} style={{ left, top }} role="menu" aria-label={`Change the ${title.toLowerCase()}`}>
      <div className="slot-menu-title">{title}</div>
      <div className="slot-menu-group">Guest</div>
      {/* Connected guests show their live video; with nobody connected the screen waits for the next guest. */}
      {guests.map((guest) => (
        <button key={guest.id} type="button" role="menuitem" className={guest.id === current ? 'guest-item current' : 'guest-item'} onClick={() => choose({ kind: 'source', id: guest.id })}>
          <GuestThumb stream={guest.stream} />
          <span>{guest.name.replace(/^GUEST:\s*/, '')}{guest.id === current ? ' · ON THIS SCREEN' : ''}</span>
        </button>
      ))}
      <button type="button" role="menuitem" className={current === null ? 'current' : ''} onClick={() => choose({ kind: 'empty' })}>
        <UserRound size={13} /> {guests.length ? 'Wait for another guest' : 'Guest (waiting for one to join)'}
      </button>
      <div className="slot-menu-group">Camera</div>
      {(cameras.length ? cameras : [{ deviceId: '', label: '' } as MediaDeviceInfo]).map((camera, index) => (
        <button key={`camera-${index}`} type="button" role="menuitem" onClick={() => choose({ kind: 'camera', deviceId: camera.deviceId })}>
          <Camera size={13} /> {camera.label || (cameras.length > 1 ? `Camera ${index + 1}` : 'Camera')}
        </button>
      ))}
      <div className="slot-menu-group">Other</div>
      <button type="button" role="menuitem" onClick={() => fileRef.current?.click()}><ImageIcon size={13} /> Image…</button>
      <button type="button" role="menuitem" onClick={() => choose({ kind: 'screen' })}><MonitorUp size={13} /> Share screen</button>
      {shared.map((item) => (
        <button key={item.id} type="button" role="menuitem" className={item.id === current ? 'current' : ''} onClick={() => choose({ kind: 'source', id: item.id })}>
          {item.kind === 'camera' ? <Camera size={13} /> : item.kind === 'screen' ? <MonitorUp size={13} /> : item.kind === 'image' ? <ImageIcon size={13} /> : <Video size={13} />} {item.name}
        </button>
      ))}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) choose({ kind: 'image', file })
          else onClose()
        }}
      />
    </div>,
    document.body,
  )
}

const LAYOUT_CHOICES: { mode: 'full' | LayoutMode; label: string; note: string; icon: typeof Maximize }[] = [
  { mode: 'full', label: 'Full screen', note: 'The camera on its own', icon: Maximize },
  { mode: 'split', label: 'Split screen', note: 'Camera left, guest right', icon: Columns2 },
  { mode: 'pip', label: 'Corner screen', note: 'Guest in a small screen you can move', icon: PictureInPicture2 },
]

// ADD CAMERA: choose which camera, and whether it goes on its own or in a layout with a guest.
export function AddCameraControl() {
  const { addCamera } = useSwitcher()
  const { open, setOpen, ref, show } = usePopover()
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [mode, setMode] = useState<'full' | LayoutMode>('full')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const loadCameras = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setCameras(all.filter((device) => device.kind === 'videoinput'))
    } catch {
      setError('This browser cannot list cameras.')
    }
  }, [])

  useEffect(() => {
    if (!open) return
    navigator.mediaDevices.addEventListener('devicechange', loadCameras)
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadCameras)
  }, [open, loadCameras])

  const onClick = () => {
    setError('')
    if (!open) void loadCameras()
    show()
  }

  // Browsers hide camera names until the page has been allowed to use a camera once.
  const allowAccess = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((track) => track.stop())
      await loadCameras()
    } catch {
      setError('Camera access was blocked. Allow it in the browser address bar, then try again.')
    }
  }

  const add = async () => {
    setBusy(true)
    await addCamera(cameras.some((camera) => camera.deviceId === deviceId) ? deviceId : '', mode)
    setBusy(false)
    setOpen(false)
  }

  const namesHidden = cameras.length > 0 && cameras.every((camera) => !camera.label)

  return (
    <div className="output-control" ref={ref}>
      <button className="capture-button" type="button" onClick={onClick} aria-expanded={open}><Camera size={14} /> ADD CAMERA</button>
      {open && (
        <Popover title="Add camera">
          <label className="field-label">Camera
            <select className="text-input" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              <option value="">Default camera</option>
              {cameras.map((camera, index) => <option key={camera.deviceId || index} value={camera.deviceId}>{camera.label || `Camera ${index + 1}`}</option>)}
            </select>
          </label>
          {namesHidden && <button className="popover-link" type="button" onClick={() => void allowAccess()}>Show camera names</button>}
          <div className="layout-choices" role="radiogroup" aria-label="Screen layout">
            {LAYOUT_CHOICES.map((choice) => (
              <button
                key={choice.mode}
                type="button"
                role="radio"
                aria-checked={mode === choice.mode}
                className={mode === choice.mode ? 'layout-choice selected' : 'layout-choice'}
                onClick={() => setMode(choice.mode)}
              >
                <span className={`layout-thumb ${choice.mode}`}><span /><span /></span>
                <strong>{choice.label}</strong>
                <small>{choice.note}</small>
              </button>
            ))}
          </div>
          {mode !== 'full' && <p className="popover-note">The next invited guest who joins goes into the empty screen. Invite guests on the Guests tab.</p>}
          {error && <p className="popover-note error">{error}</p>}
          <div className="popover-actions">
            <button className="button button-primary" type="button" onClick={() => void add()} disabled={busy}><Plus size={13} /> ADD TO PREVIEW</button>
          </div>
        </Popover>
      )}
    </div>
  )
}
