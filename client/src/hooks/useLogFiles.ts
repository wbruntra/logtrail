import { useState, useEffect } from 'react'
import type { LogFile } from '../types/logTypes'

interface UseLogFilesReturn {
  logFiles: LogFile[]
  selectedLog: string
  setSelectedLog: (path: string) => void
  loading: boolean
  error: string | null
}

export const useLogFiles = (): UseLogFilesReturn => {
  const [logFiles, setLogFiles] = useState<LogFile[]>([])
  const [selectedLog, setSelectedLog] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const urlLog = new URLSearchParams(window.location.search).get('log')

    fetch('/api/logs/list', {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        const logs: LogFile[] = data.logs || []
        setLogFiles(logs)

        if (logs.length > 0) {
          // Restore from URL if the log still exists, otherwise use the first
          const fromUrl = urlLog && logs.find((l) => l.path === urlLog)
          setSelectedLog(fromUrl ? urlLog : logs[0].path)
        }

        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const setSelectedLogAndUrl = (path: string) => {
    setSelectedLog(path)
    const params = new URLSearchParams(window.location.search)
    params.set('log', path)
    window.history.replaceState(null, '', `?${params.toString()}`)
  }

  return {
    logFiles,
    selectedLog,
    setSelectedLog: setSelectedLogAndUrl,
    loading,
    error,
  }
}
