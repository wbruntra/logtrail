import { useState, useEffect, useCallback, useRef } from 'react'
import type { LogLine } from '../types/logTypes'

interface UseLogStreamReturn {
  logs: LogLine[]
  eventSource: EventSource | null
  connectToLog: (logPath: string) => void
  disconnect: () => void
  setLogs: React.Dispatch<React.SetStateAction<LogLine[]>>
}

export const useLogStream = (): UseLogStreamReturn => {
  const [logs, setLogs] = useState<LogLine[]>([])
  const [eventSource, setEventSource] = useState<EventSource | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  // Keep ref in sync with state
  useEffect(() => {
    eventSourceRef.current = eventSource
  }, [eventSource])

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      setEventSource(null)
    }
  }, [])

  const connectToLog = useCallback((logPath: string) => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    if (!logPath) return

    // Create new EventSource without clearing existing logs
    const es = new EventSource(`/api/logs/stream?file=${encodeURIComponent(logPath)}`)
    
    es.onmessage = (event) => {
      const newLogLine: LogLine = JSON.parse(event.data)
      setLogs((prevLogs) => [...prevLogs, newLogLine])
    }
    
    es.onerror = (err) => {
      console.error('EventSource failed:', err)
      es.close()
      setEventSource(null)
    }
    
    setEventSource(es)
    eventSourceRef.current = es
  }, [])

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  return {
    logs,
    eventSource,
    connectToLog,
    disconnect,
    setLogs
  }
}
