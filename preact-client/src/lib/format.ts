const nf = new Intl.NumberFormat()
export const num = (n: number) => nf.format(n)

export function plural(n: number, one: string, many = `${one}s`) {
  return `${num(n)} ${n === 1 ? one : many}`
}

/** "just now", "4m ago", "3h ago", "2d ago" */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const s = Math.round((now - Date.parse(iso)) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/** "14:03:22" today, "Nov 3 14:03:22" otherwise */
export function time(iso: string, { seconds = true } = {}): string {
  const d = new Date(iso)
  const t = d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: seconds ? '2-digit' : undefined,
    hour12: false,
  })
  if (sameDay(d, new Date())) return t
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${t}`
}

export function fullTime(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium', hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** Bucket axis/tooltip label: time of day, with the date when it changes */
export function bucketLabel(iso: string, bucketMs: number): string {
  const d = new Date(iso)
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  if (bucketMs >= 60 * 60 * 1000 && d.getHours() === 0) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
  return t
}

export function bucketRange(iso: string, bucketMs: number): string {
  const start = new Date(iso)
  const end = new Date(start.getTime() + bucketMs)
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false }
  const day = start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
  return `${day}, ${start.toLocaleTimeString([], opts)}–${end.toLocaleTimeString([], opts)}`
}

export function duration(ms: number | null): string | null {
  if (ms === null) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
}
