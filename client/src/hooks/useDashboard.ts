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
}

export interface DashboardData {
  period: number
  totals: { errors: number; warns: number }
  byApp: AppStat[]
  byHour: HourBucket[]
  topCodes: TopCode[]
  recentErrors: RecentError[]
}

export function useDashboard(hours: number) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/dashboard?hours=${hours}`, {
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
  }, [hours])

  useEffect(() => {
    fetch_()
    // Refresh every 60 seconds
    const id = setInterval(fetch_, 60_000)
    return () => clearInterval(id)
  }, [fetch_])

  return { data, loading, error, refresh: fetch_ }
}
