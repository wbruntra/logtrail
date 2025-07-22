import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { useUser } from './UserContext'
import LoginForm from './LoginForm'
import './App.scss'

function App() {
  const { user, setUser } = useUser()
  const [logs, setLogs] = useState<string[]>([])
  const logContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const historyLoadLock = useRef(false)
  const scrollRestoreRef = useRef<{
    prevScrollHeight: number
    prevScrollTop: number
    pending: boolean
  }>({ prevScrollHeight: 0, prevScrollTop: 0, pending: false })
  const [logFiles, setLogFiles] = useState<{ name: string; path: string; description?: string }[]>(
    [],
  )
  const [selectedLog, setSelectedLog] = useState<string>('')
  const [eventSource, setEventSource] = useState<EventSource | null>(null)
  const [historyOffset, setHistoryOffset] = useState<number | undefined>(undefined)
  const [hasMoreHistory, setHasMoreHistory] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)

  // On mount, check auth status
  useEffect(() => {
    fetch('/api/status', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          setUser({ username: 'user', authenticated: true })
        } else {
          setUser(null)
        }
      })
      .finally(() => setCheckingAuth(false))
  }, [setUser])

  // Fetch log file list on mount if authenticated
  useEffect(() => {
    if (!user) return
    fetch('/api/logs/list', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        setLogFiles(data.logs || [])
        if (data.logs && data.logs.length > 0) {
          setSelectedLog(data.logs[0].path)
        }
      })
  }, [user])

  // Fetch last 100 lines and connect to log stream when selectedLog changes
  useEffect(() => {
    if (!user || !selectedLog) return
    setLogs([])
    setHistoryOffset(undefined)
    setHasMoreHistory(true)
    if (eventSource) {
      eventSource.close()
    }
    fetch(`/api/logs/history?file=${encodeURIComponent(selectedLog)}&limit=100`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        let initialLines: string[] = []
        if (data && Array.isArray(data.lines)) {
          initialLines = data.lines
        }
        setLogs(initialLines)
        setHistoryOffset(data.nextBefore)
        setHasMoreHistory(data.hasMore)
        const es = new EventSource(`/api/logs/stream?file=${encodeURIComponent(selectedLog)}`)
        es.onmessage = (event) => {
          const newLog = JSON.parse(event.data)
          setLogs((prevLogs) => [...prevLogs, newLog])
        }
        es.onerror = (err) => {
          console.error('EventSource failed:', err)
          es.close()
        }
        setEventSource(es)
      })
    return () => {
      if (eventSource) eventSource.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedLog])

  // Infinite scroll up: load more history when near the top
  const loadMoreHistory = async () => {
    if (
      !user ||
      !selectedLog ||
      !hasMoreHistory ||
      loadingHistory ||
      historyOffset === 0 ||
      historyLoadLock.current
    )
      return
    setLoadingHistory(true)
    historyLoadLock.current = true
    if (logContainerRef.current) {
      scrollRestoreRef.current.prevScrollHeight = logContainerRef.current.scrollHeight
      scrollRestoreRef.current.prevScrollTop = logContainerRef.current.scrollTop
      scrollRestoreRef.current.pending = true
    }
    const res = await fetch(
      `/api/logs/history?file=${encodeURIComponent(
        selectedLog,
      )}&limit=100&before=${historyOffset}`,
      { credentials: 'include' }
    )
    const data = await res.json()
    if (data && Array.isArray(data.lines) && data.lines.length > 0) {
      setLogs((prev) => [...data.lines, ...prev])
      setHistoryOffset(data.nextBefore)
      setHasMoreHistory(data.hasMore)
    } else {
      setHasMoreHistory(false)
    }
    setLoadingHistory(false)
  }
  // Restore scroll position after prepending history lines
  useLayoutEffect(() => {
    if (scrollRestoreRef.current.pending && logContainerRef.current) {
      const { prevScrollHeight, prevScrollTop } = scrollRestoreRef.current
      logContainerRef.current.scrollTop =
        logContainerRef.current.scrollHeight - prevScrollHeight + prevScrollTop
      scrollRestoreRef.current.pending = false
    }
  }, [logs])

  // Auto-scroll logic
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // Detect user scroll to disable auto-scroll and trigger history loading
  const handleScroll = () => {
    const el = logContainerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10
    setAutoScroll(atBottom)
    // If near the top, load more history (only once until user scrolls away)
    if (el.scrollTop < 100 && hasMoreHistory && !loadingHistory && !historyLoadLock.current) {
      loadMoreHistory()
    }
    // Reset lock if user scrolls away from the top
    if (el.scrollTop >= 100 && historyLoadLock.current) {
      historyLoadLock.current = false
    }
  }

  if (checkingAuth) {
    return <div>Loading...</div>
  }
  if (!user) {
    return <LoginForm />
  }

  return (
    <div className="App">
      {/* ...existing code... */}
      <header className="App-header">{/* ...existing code... */}</header>
      <div className="main-content">
        <div className="log-container" ref={logContainerRef} onScroll={handleScroll}>
          {loadingHistory && (
            <div
              style={{ textAlign: 'center', fontSize: '0.9em', color: '#888', marginBottom: 8 }}
            >
              Loading older logs...
            </div>
          )}
          <pre className="mb-0">
            {logs.map((log, index) => (
              <div key={index}>{log}</div>
            ))}
          </pre>
          <button
            className={`autoscroll-toggle btn btn-${autoScroll ? 'secondary' : 'primary'}`}
            title={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
            onClick={() => {
              if (!autoScroll && logContainerRef.current) {
                logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
              }
              setAutoScroll((v) => !v)
            }}
          >
            {autoScroll ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                fill="currentColor"
                viewBox="0 0 16 16"
              >
                <rect x="3" y="2" width="3" height="12" rx="1" />
                <rect x="10" y="2" width="3" height="12" rx="1" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                fill="currentColor"
                viewBox="0 0 16 16"
              >
                <polygon points="3,2 14,8 3,14" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App
