import { useCallback, useEffect, useRef, useState } from 'react'

type View = 'menu' | 'settings'

// A small panel that opens under its button and closes on an outside click or Escape.
export function usePopover() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('menu')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const show = useCallback(() => {
    setView('menu')
    setOpen((current) => !current)
  }, [])

  return { open, setOpen, view, setView, ref, show }
}
