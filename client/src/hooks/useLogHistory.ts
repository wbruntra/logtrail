import { useState, useRef, useCallback } from 'react'
import type { LogLine } from '../types/logTypes'

interface UseLogHistoryReturn {
  historyOffset: number | undefined
  setHistoryOffset: (offset: number | undefined) => void
  hasMoreHistory: boolean
  setHasMoreHistory: (hasMore: boolean) => void
  loadingHistory: boolean
  loadMoreHistory: (selectedLog: string, setLogs: React.Dispatch<React.SetStateAction<LogLine[]>>) => Promise<void>
  resetHistory: () => void
  historyLoadLock: React.MutableRefObject<boolean>
}

export const useLogHistory = (): UseLogHistoryReturn => {
  const [historyOffset, setHistoryOffset] = useState<number | undefined>(undefined)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const historyLoadLock = useRef(false)

  const loadMoreHistory = useCallback(async (
    selectedLog: string,
    setLogs: React.Dispatch<React.SetStateAction<LogLine[]>>
  ) => {
    if (
      !selectedLog ||
      !hasMoreHistory ||
      loadingHistory ||
      historyOffset === 0 ||
      historyLoadLock.current
    )
      return

    setLoadingHistory(true)
    historyLoadLock.current = true

    try {
      const res = await fetch(
        `/api/logs/history?file=${encodeURIComponent(
          selectedLog,
        )}&limit=100&before=${historyOffset}`,
        { credentials: 'include' },
      )
      const data = await res.json()
      
      if (data && Array.isArray(data.lines) && data.lines.length > 0) {
        setLogs((prev) => [...data.lines, ...prev])
        setHistoryOffset(data.nextBefore)
        setHasMoreHistory(data.hasMore)
      } else {
        setHasMoreHistory(false)
      }
    } catch (error) {
      console.error('Failed to load history:', error)
    } finally {
      setLoadingHistory(false)
    }
  }, [historyOffset, hasMoreHistory, loadingHistory, setHistoryOffset, setHasMoreHistory])

  const resetHistory = useCallback(() => {
    setHistoryOffset(undefined)
    setHasMoreHistory(true)
    historyLoadLock.current = false
  }, [])

  return {
    historyOffset,
    setHistoryOffset,
    hasMoreHistory,
    setHasMoreHistory,
    loadingHistory,
    loadMoreHistory,
    resetHistory,
    historyLoadLock
  }
}
