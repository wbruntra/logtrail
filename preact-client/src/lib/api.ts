import type { IssueState } from '@shared/api-types.ts'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { setAuthenticated } from './auth'

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init })
  if (res.status === 401) setAuthenticated(false)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`, res.status)
  }
  return res.json() as Promise<T>
}

const pathOf = (url: string | null) => url?.split('?')[0] ?? null

export interface Resource<T> {
  data: T | null
  error: ApiError | Error | null
  loading: boolean
  /** When data was last fetched successfully */
  updatedAt: number | null
  reload: () => void
}

/**
 * Fetches `url` (null to skip) and refetches when it changes, every `poll` ms
 * while the tab is visible, and when the tab becomes visible again. Keeps the
 * previous data while refetching so views don't flash.
 */
export function useApi<T>(url: string | null, { poll }: { poll?: number } = {}): Resource<T> {
  const [state, setState] = useState<Omit<Resource<T>, 'reload'>>({
    data: null,
    error: null,
    loading: url !== null,
    updatedAt: null,
  })
  const pathRef = useRef(pathOf(url))
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  // A different resource drops the old data rather than show it under the new
  // one; a new query (another time window, say) keeps it until the refetch lands.
  if (pathRef.current !== pathOf(url)) {
    pathRef.current = pathOf(url)
    if (state.data !== null || state.error !== null) {
      setState({ data: null, error: null, loading: url !== null, updatedAt: null })
    }
  }

  useEffect(() => {
    if (url === null) return
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true }))
    api<T>(url, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false, updatedAt: Date.now() }))
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false }))
      })
    return () => controller.abort()
  }, [url, nonce])

  useEffect(() => {
    if (!poll || url === null) return
    const timer = setInterval(() => document.hidden || reload(), poll)
    const onVisible = () => document.hidden || reload()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [poll, url, reload])

  return { ...state, reload }
}

export function setIssueState(fingerprints: string[], state: IssueState) {
  return api<{ ok: true }>('/api/issues/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprints, state }),
  })
}
