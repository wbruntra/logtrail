import { useState, useEffect, useCallback } from 'react'

export interface AppStat {
  app: string
  errors: number
  warns: number
}

export interface HourBucket {
  hour: string
  errors: number
  warns: number
}

export interface TopCode {
  code: string
  count: number
}

/** A single stored event, as shown in the detail view. */
export interface EventDetail {
  id: number
  ts: string
  app: string
  level: string
  msg: string
  code?: string | null
  method?: string | null
  path?: string | null
  route?: string | null
  status?: number | null
  duration?: number | null
  reqId?: string | null
  userId?: string | number | null
  release?: string | null
  stack?: string | null
  [field: string]: unknown
}

export interface RecentError extends EventDetail {
  fingerprint: string | null
}

/** Errors and warnings grouped by fingerprint. */
export interface Issue {
  fingerprint: string
  app: string
  level: 'error' | 'warn'
  msg: string
  code: string | null
  method: string | null
  route: string | null
  status: number | null
  count: number
  users: number
  firstSeen: string
  lastSeen: string
  releases: string[]
  latestId: number
}

export interface IssueDetail extends Issue {
  events: EventDetail[]
}

export interface DashboardData {
  period: number
  totals: { errors: number; warns: number }
  byApp: AppStat[]
  byHour: HourBucket[]
  topCodes: TopCode[]
  issues: Issue[]
  recentErrors: RecentError[]
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function useDashboard(hours: number, levels: string[]) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const levelsKey = levels.slice().sort().join(',')

  const fetch_ = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ hours: String(hours), levels: levelsKey })
      const res = await fetch(`/api/dashboard?${params}`, {
        headers: authHeaders(),
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [hours, levelsKey])

  useEffect(() => {
    fetch_()
    // Refresh every 60 seconds
    const id = setInterval(fetch_, 60_000)
    return () => clearInterval(id)
  }, [fetch_])

  return { data, loading, error, refresh: fetch_ }
}

/** Loads one issue and its recent occurrences; idle while fingerprint is null. */
export function useIssue(fingerprint: string | null) {
  const [issue, setIssue] = useState<IssueDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIssue(null)
    setError(null)
    if (!fingerprint) return
    let cancelled = false
    fetch(`/api/dashboard/issues/${fingerprint}`, {
      headers: authHeaders(),
      credentials: 'include',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: IssueDetail = await res.json()
        if (!cancelled) setIssue(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load issue')
      })
    return () => {
      cancelled = true
    }
  }, [fingerprint])

  return { issue, loading: !!fingerprint && !issue && !error, error }
}
