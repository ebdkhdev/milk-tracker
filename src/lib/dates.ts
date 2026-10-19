export function todayStr(d?: Date) {
  const dt = d || new Date()
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + day
}

export function isToday(dateStr: string) {
  return dateStr === todayStr(new Date())
}

export function isYesterday(dateStr: string) {
  const y = new Date()
  y.setDate(y.getDate() - 1)
  return dateStr === todayStr(y)
}

export function formatTime(iso: string) {
  const d = new Date(iso)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

export function nowHHMM() {
  return formatTime(new Date().toISOString())
}

// ISO timestamp for a feed on dateStr at HH:MM (noon when no time is given)
export function timeOnDate(dateStr: string, hhmm: string) {
  if (!hhmm) return new Date(dateStr + 'T12:00:00').toISOString()
  return new Date(dateStr + 'T' + hhmm + ':00').toISOString()
}

export function parseDay(dateStr: string) {
  return new Date(dateStr + 'T00:00:00')
}
