// iPadOS reports itself as a Mac; touch support tells them apart.
export function isIos() {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}
// opened from the home screen icon (installed PWA), not in a browser tab
export function isStandalone() {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
}
