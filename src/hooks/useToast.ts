import { useCallback, useEffect, useRef, useState } from 'react'
import type { ToastMsg } from '#/components/Toast'

// One message at a time; a new one replaces the previous (and its undo). With undo it stays 6 s, else 3 s.
export function useToast() {
  const [toast, setToast] = useState<ToastMsg | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const showToast = useCallback((text: string, undo?: () => void) => {
    clearTimeout(timer.current)
    setToast({ id: Date.now(), text, undo })
    timer.current = setTimeout(() => setToast(null), undo ? 6000 : 3000)
  }, [])
  const closeToast = useCallback(() => { clearTimeout(timer.current); setToast(null) }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return { toast, showToast, closeToast }
}
