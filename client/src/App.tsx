import { useEffect, useCallback, useState } from 'react'
import './App.scss'
import './styles/ansiColors.css'
import './styles/modals.css'
import Header from './components/Header'
import LogViewer from './components/LogViewer'
import SearchResults from './components/SearchResults'
import ContextViewer from './components/ContextViewer'
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
    contextData,
    isSearching: isBackendSearching,
    isLoadingContext,
    searchFile,
    getContext,
    clearResults,
    clearContext,
  } = useBackendSearch()

  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showContextViewer, setShowContextViewer] = useState(() => {
    return !!new URLSearchParams(window.location.search).get('line')
  })

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

  const handleResultClick = useCallback(
    (lineNumber: number) => {
      if (!selectedLog) return
      setShowSearchResults(false)
      setShowContextViewer(true)
      const params = new URLSearchParams(window.location.search)
      params.set('line', lineNumber.toString())
      window.history.replaceState(null, '', `?${params.toString()}`)
      getContext(selectedLog, lineNumber, 20)
    },
    [selectedLog, getContext],
  )

  const handleCloseContext = useCallback(() => {
    setShowContextViewer(false)
    clearContext()
    const params = new URLSearchParams(window.location.search)
    params.delete('line')
    window.history.replaceState(null, '', `?${params.toString()}`)
  }, [clearContext])

  const handleBackToResults = useCallback(() => {
    setShowContextViewer(false)
    setShowSearchResults(true)
    const params = new URLSearchParams(window.location.search)
    params.delete('line')
    window.history.replaceState(null, '', `?${params.toString()}`)
  }, [])

  // On initial load, if ?line=X is in the URL, fetch context once the log is selected
  useEffect(() => {
    const urlLine = new URLSearchParams(window.location.search).get('line')
    if (urlLine && selectedLog) {
      getContext(selectedLog, parseInt(urlLine), 20)
    }
  }, [selectedLog])

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
        onResultClick={handleResultClick}
        onClose={handleCloseSearchResults}
        show={showSearchResults}
      />

      <ContextViewer
        contextData={contextData}
        isLoading={isLoadingContext}
        show={showContextViewer}
        onBack={handleBackToResults}
        onClose={handleCloseContext}
      />
    </div>
  )
}

export default App
