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

export interface RecentError {
  ts: string
  app: string
  level: string
  code: string | null
  msg: string
  method: string | null
  path: string | null
  status: number | null
  duration: number | null
  reqId: string | null
  userId: string | number | null
  stack: string | null
}

export interface DashboardData {
  period: number
  totals: { errors: number; warns: number }
  byApp: AppStat[]
  byHour: HourBucket[]
  topCodes: TopCode[]
  recentErrors: RecentError[]
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
      const token = localStorage.getItem('token')
      const params = new URLSearchParams({ hours: String(hours), levels: levelsKey })
      const res = await fetch(`/api/dashboard?${params}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
