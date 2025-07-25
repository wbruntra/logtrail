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
    fetch('/api/logs/list')
      .then((res) => res.json())
      .then((data) => {
        setLogFiles(data.logs || [])
        if (data.logs && data.logs.length > 0) {
          setSelectedLog(data.logs[0].path)
        }
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return {
    logFiles,
    selectedLog,
    setSelectedLog,
    loading,
    error
  }
}
