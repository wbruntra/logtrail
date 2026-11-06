import { useEffect, useState } from 'preact/hooks'

// null while the first /api/status check is in flight
let authenticated: boolean | null = null
const listeners = new Set<(v: boolean | null) => void>()

export function setAuthenticated(value: boolean) {
  if (authenticated === value) return
  authenticated = value
  listeners.forEach((fn) => fn(value))
}

export function useAuthenticated(): boolean | null {
  const [value, setValue] = useState(authenticated)
  useEffect(() => {
    listeners.add(setValue)
    return () => void listeners.delete(setValue)
  }, [])
  return value
}

export async function checkStatus() {
  try {
    const res = await fetch('/api/status', { credentials: 'include' })
    const body = (await res.json()) as { authenticated?: boolean }
    setAuthenticated(Boolean(body.authenticated))
  } catch {
    setAuthenticated(false)
  }
}

export async function login(password: string): Promise<string | null> {
  const res = await fetch('/api/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (res.ok) {
    setAuthenticated(true)
    return null
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? 'Login failed'
}

export async function logout() {
  await fetch('/api/logout', { credentials: 'include' }).catch(() => {})
  setAuthenticated(false)
}
