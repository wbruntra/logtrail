import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchEventSource, EventStreamContentType } from '@microsoft/fetch-event-source'
import type { LogLine } from '../types/logTypes'

interface UseLogStreamReturn {
  logs: LogLine[]
  connectToLog: (logPath: string) => void
  disconnect: () => void
  setLogs: React.Dispatch<React.SetStateAction<LogLine[]>>
}

class FatalStreamError extends Error {}

class RetriableStreamError extends Error {}

export const useLogStream = (): UseLogStreamReturn => {
  const [logs, setLogs] = useState<LogLine[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)

  const disconnect = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  const connectToLog = useCallback((logPath: string) => {
    // Close existing connection
    disconnect()

    if (!logPath) return

    const abortController = new AbortController()
    abortControllerRef.current = abortController
    const token = localStorage.getItem('token')

    void fetchEventSource(`/api/logs/stream?file=${encodeURIComponent(logPath)}`, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      signal: abortController.signal,
      async onopen(response) {
        const contentType = response.headers.get('content-type')

        if (response.ok && contentType?.includes(EventStreamContentType)) {
          return
        }

        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new FatalStreamError(`Stream request failed with HTTP ${response.status}`)
        }

        throw new RetriableStreamError(`Stream request failed with HTTP ${response.status}`)
      },
      onmessage(event) {
        if (event.event === 'ping' || !event.data) return

        const newLogLine: LogLine = JSON.parse(event.data)
        setLogs((prevLogs) => [...prevLogs, newLogLine])
      },
      onclose() {
        if (!abortController.signal.aborted) {
          throw new RetriableStreamError('Stream closed unexpectedly')
        }
      },
      onerror(err) {
        if (abortController.signal.aborted) {
          return
        }

        if (err instanceof FatalStreamError) {
          console.error('Log stream authentication failed:', err)
          throw err
        }

        console.error('Log stream temporarily interrupted:', err)
      },
    })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error('Failed to connect to log stream:', error)
        }
      })
      .finally(() => {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null
        }
      })
  }, [disconnect])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    logs,
    connectToLog,
    disconnect,
    setLogs,
  }
}
