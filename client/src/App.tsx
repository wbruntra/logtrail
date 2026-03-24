import { useEffect, useCallback, useState } from 'react'
import './App.scss'
import './styles/ansiColors.css'
import './styles/modals.css'
import Header from './components/Header'
import LogViewer from './components/LogViewer'
import SearchResults from './components/SearchResults'
import { useLogFiles } from './hooks/useLogFiles'
import { useLogStream } from './hooks/useLogStream'
import { useLogHistory } from './hooks/useLogHistory'
import { useAutoScroll } from './hooks/useAutoScroll'
import { useLogSearch } from './hooks/useLogSearch'
import { useBackendSearch } from './hooks/useBackendSearch'
import type { LogLine } from './types/logTypes'

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
    historyLoadLock,
  } = useLogHistory()

  const {
    autoScroll,
    setAutoScroll,
    handleScroll: baseHandleScroll,
    containerRef,
    scrollRestoreRef,
  } = useAutoScroll(logs)

  const {
    searchQuery,
    setSearchQuery,
    filteredLogs,
    isSearching,
    matchCount,
    clearSearch,
    debouncedQuery,
  } = useLogSearch(logs)

  const {
    searchResults,
    isSearching: isBackendSearching,
    searchFile,
    clearResults,
  } = useBackendSearch()

  const [showSearchResults, setShowSearchResults] = useState(false)

  const handleScroll = useCallback(() => {
    baseHandleScroll()

    const el = containerRef.current
    if (!el) return

    if (el.scrollTop < 100 && hasMoreHistory && !loadingHistory && !historyLoadLock.current) {
      scrollRestoreRef.current.prevScrollHeight = el.scrollHeight
      scrollRestoreRef.current.prevScrollTop = el.scrollTop
      scrollRestoreRef.current.pending = true
      loadMoreHistory(selectedLog, setLogs)
    }

    if (el.scrollTop >= 100 && historyLoadLock.current) {
      historyLoadLock.current = false
    }
  }, [
    baseHandleScroll,
    containerRef,
    hasMoreHistory,
    loadingHistory,
    historyLoadLock,
    loadMoreHistory,
    selectedLog,
    setLogs,
    scrollRestoreRef,
  ])

  useEffect(() => {
    if (!selectedLog) return

    resetHistory()

    const token = localStorage.getItem('token')
    fetch(`/api/logs/history?file=${encodeURIComponent(selectedLog)}&limit=150`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        let initialLines: LogLine[] = []
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

  const handleBackendSearch = useCallback(
    async (query: string) => {
      if (selectedLog) {
        await searchFile(selectedLog, query)
        setShowSearchResults(true)
      }
    },
    [selectedLog, searchFile],
  )

  const handleCloseSearchResults = useCallback(() => {
    setShowSearchResults(false)
    clearResults()
  }, [clearResults])

  return (
    <div className="App" data-bs-theme="dark">
      <Header
        logFiles={logFiles}
        selectedLog={selectedLog}
        onLogChange={setSelectedLog}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onClearSearch={clearSearch}
        isSearching={isSearching}
        matchCount={matchCount}
        totalCount={logs.length}
        onBackendSearch={handleBackendSearch}
        backendSearchLoading={isBackendSearching}
      />
      <div className="main-content">
        <LogViewer
          logs={filteredLogs}
          autoScroll={autoScroll}
          onAutoScrollChange={setAutoScroll}
          onScroll={handleScroll}
          loadingHistory={loadingHistory}
          containerRef={containerRef}
          searchQuery={searchQuery}
          debouncedQuery={debouncedQuery}
        />
      </div>

      <SearchResults
        results={searchResults}
        query={searchQuery}
        isLoading={isBackendSearching}
        onLineClick={handleCloseSearchResults}
        onClose={handleCloseSearchResults}
        show={showSearchResults}
      />
    </div>
  )
}

export default App
