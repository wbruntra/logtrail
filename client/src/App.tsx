import { useEffect, useCallback } from 'react'
import './App.scss'
import Header from './components/Header'
import LogViewer from './components/LogViewer'
import { useLogFiles } from './hooks/useLogFiles'
import { useLogStream } from './hooks/useLogStream'
import { useLogHistory } from './hooks/useLogHistory'
import { useAutoScroll } from './hooks/useAutoScroll'

function App() {
  const { logFiles, selectedLog, setSelectedLog } = useLogFiles()
  const { logs, connectToLog, setLogs } = useLogStream()
  const { 
    setHistoryOffset,
    hasMoreHistory,
    setHasMoreHistory,
    loadingHistory, 
    loadMoreHistory, 
    resetHistory, 
    historyLoadLock 
  } = useLogHistory()
  
  const { 
    autoScroll, 
    setAutoScroll, 
    handleScroll: baseHandleScroll, 
    containerRef,
    scrollRestoreRef
  } = useAutoScroll(logs)

  // Enhanced scroll handler that includes history loading logic
  const handleScroll = useCallback(() => {
    baseHandleScroll() // Handle auto-scroll state
    
    const el = containerRef.current
    if (!el) return

    // If near the top, load more history (only once until user scrolls away)
    if (el.scrollTop < 100 && hasMoreHistory && !loadingHistory && !historyLoadLock.current) {
      // Store scroll position before loading history
      scrollRestoreRef.current.prevScrollHeight = el.scrollHeight
      scrollRestoreRef.current.prevScrollTop = el.scrollTop
      scrollRestoreRef.current.pending = true
      loadMoreHistory(selectedLog, setLogs)
    }

    // Reset lock if user scrolls away from the top
    if (el.scrollTop >= 100 && historyLoadLock.current) {
      historyLoadLock.current = false
    }
  }, [baseHandleScroll, containerRef, hasMoreHistory, loadingHistory, historyLoadLock, loadMoreHistory, selectedLog, setLogs, scrollRestoreRef])

  // Fetch last 100 lines and connect to log stream when selectedLog changes
  useEffect(() => {
    if (!selectedLog) return
    
    resetHistory()
    
    fetch(`/api/logs/history?file=${encodeURIComponent(selectedLog)}&limit=150`, {
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        let initialLines: string[] = []
        if (data && Array.isArray(data.lines)) {
          initialLines = data.lines
        }
        setLogs(initialLines)
        setHistoryOffset(data.nextBefore)
        setHasMoreHistory(data.hasMore)
        connectToLog(selectedLog)
      })
      .catch((error) => {
        console.error('Error fetching initial history:', error)
      })
  }, [selectedLog])

  return (
    <div className="App" data-bs-theme="dark">
      <Header 
        logFiles={logFiles}
        selectedLog={selectedLog}
        onLogChange={setSelectedLog}
      />
      <div className="main-content">
        <LogViewer
          logs={logs}
          autoScroll={autoScroll}
          onAutoScrollChange={setAutoScroll}
          onScroll={handleScroll}
          loadingHistory={loadingHistory}
          containerRef={containerRef}
        />
      </div>
    </div>
  )
}

export default App
