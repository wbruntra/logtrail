import { useEffect, useState } from 'preact/hooks'

// The dashboard time window, shared by every view and remembered per browser.

export const WINDOWS = [
  { hours: 1, label: '1h' },
  { hours: 6, label: '6h' },
  { hours: 24, label: '24h' },
  { hours: 72, label: '3d' },
] as const

const KEY = 'logtrail.hours'

function read(): number {
  try {
    const n = Number(localStorage.getItem(KEY))
    return WINDOWS.some((w) => w.hours === n) ? n : 24
  } catch {
    return 24
  }
}

let hours = read()
const listeners = new Set<(h: number) => void>()

export function setHours(h: number) {
  hours = h
  try {
    localStorage.setItem(KEY, String(h))
  } catch {}
  listeners.forEach((fn) => fn(h))
}

export function useHours(): number {
  const [value, setValue] = useState(hours)
  useEffect(() => {
    listeners.add(setValue)
    return () => void listeners.delete(setValue)
  }, [])
  return value
}
