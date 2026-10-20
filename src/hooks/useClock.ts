import { useCallback, useEffect, useState } from 'react'

// The current time, refreshed every minute and whenever the app comes back to the foreground.
// refresh() is called after each write so "last bottle" never reads a time ahead of `now`.
export function useClock() {
  const [now, setNow] = useState(() => new Date())
  const refresh = useCallback(() => setNow(new Date()), [])
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) refresh() }
    const id = setInterval(refresh, 60 * 1000)
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])
  return { now, refresh }
}
