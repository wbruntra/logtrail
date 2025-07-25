import { useState, useEffect, useCallback, useRef } from 'react'

interface UseLogStreamReturn {
  logs: string[]
  eventSource: EventSource | null
  connectToLog: (logPath: string) => void
  disconnect: () => void
  setLogs: React.Dispatch<React.SetStateAction<string[]>>
}

export const useLogStream = (): UseLogStreamReturn => {
  const [logs, setLogs] = useState<string[]>([])
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
      const newLog = JSON.parse(event.data)
      setLogs((prevLogs) => [...prevLogs, newLog])
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
