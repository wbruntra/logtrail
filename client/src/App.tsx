import { useEffect, useCallback, useState } from 'react'
import './App.scss'
import './styles/ansiColors.css'
import './styles/modals.css'
import Header from './components/Header'
import LogViewer from './components/LogViewer'
import { useLogFiles } from './hooks/useLogFiles'
import { useLogStream } from './hooks/useLogStream'
import { useLogHistory } from './hooks/useLogHistory'
import { useAutoScroll } from './hooks/useAutoScroll'
import { useBackendSearch } from './hooks/useBackendSearch'
import type { LogLine } from './types/logTypes'

type ViewMode = 'live' | 'search' | 'context'

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
    searchResults,
    contextData,
    isSearching: isBackendSearching,
    isLoadingContext,
    searchFile,
    getContext,
    clearResults,
    clearContext,
  } = useBackendSearch()

  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    new URLSearchParams(window.location.search).get('line') ? 'context' : 'live'
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Debounce search input → trigger backend search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setDebouncedQuery('')
      return
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim())
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    if (!debouncedQuery || !selectedLog) return
    searchFile(selectedLog, debouncedQuery)
    setViewMode('search')
  }, [debouncedQuery, selectedLog])

  // On initial load, if ?line=X is present, fetch context once the log is selected
  useEffect(() => {
    const urlLine = new URLSearchParams(window.location.search).get('line')
    if (urlLine && selectedLog) {
      getContext(selectedLog, parseInt(urlLine), 20)
      setViewMode('context')
    }
  }, [selectedLog])

  const handleScroll = useCallback(() => {
    if (viewMode !== 'live') return
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
    viewMode,
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

  const handleLineNumberClick = useCallback(
    (lineNumber: number) => {
      if (!selectedLog) return
      getContext(selectedLog, lineNumber, 20)
      setViewMode('context')
      const params = new URLSearchParams(window.location.search)
      params.set('line', lineNumber.toString())
      window.history.replaceState(null, '', `?${params.toString()}`)
    },
    [selectedLog, getContext],
  )

  const handleExitContext = useCallback(() => {
    clearContext()
    const params = new URLSearchParams(window.location.search)
    params.delete('line')
    window.history.replaceState(null, '', `?${params.toString()}`)
    setViewMode(debouncedQuery ? 'search' : 'live')
  }, [clearContext, debouncedQuery])

  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
    setDebouncedQuery('')
    setViewMode('live')
    clearResults()
    clearContext()
    const params = new URLSearchParams(window.location.search)
    params.delete('line')
    window.history.replaceState(null, '', `?${params.toString()}`)
  }, [clearResults, clearContext])

  const displayLogs: LogLine[] =
    viewMode === 'search'
      ? searchResults
      : viewMode === 'context'
        ? (contextData?.lines ?? [])
        : logs

  const bannerText =
    viewMode === 'search'
      ? isBackendSearching
        ? `Searching for "${debouncedQuery}"…`
        : `${searchResults.length} match${searchResults.length === 1 ? '' : 'es'} for "${debouncedQuery}" — click a line number to see context`
      : viewMode === 'context'
        ? isLoadingContext
          ? 'Loading context…'
          : `Context around line ${contextData?.targetLine}`
        : null

  return (
    <div className="App" data-bs-theme="dark">
      <Header
        logFiles={logFiles}
        selectedLog={selectedLog}
        onLogChange={setSelectedLog}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onClearSearch={handleClearSearch}
        isSearching={isBackendSearching}
        matchCount={searchResults.length}
      />
      <div className="main-content">
        {bannerText && (
          <div className="view-mode-banner">
            <span className="view-mode-banner-text">{bannerText}</span>
            <div className="view-mode-banner-actions">
              {viewMode === 'context' && debouncedQuery && (
                <button className="btn btn-sm btn-outline-secondary" onClick={handleExitContext}>
                  ← Back to results
                </button>
              )}
              <button className="btn btn-sm btn-outline-secondary" onClick={handleClearSearch}>
                Exit search
              </button>
            </div>
          </div>
        )}
        <LogViewer
          logs={displayLogs}
          autoScroll={viewMode === 'live' ? autoScroll : false}
          onAutoScrollChange={setAutoScroll}
          onScroll={handleScroll}
          loadingHistory={viewMode === 'live' ? loadingHistory : false}
          containerRef={containerRef}
          debouncedQuery={viewMode === 'search' ? debouncedQuery : ''}
          onLineNumberClick={viewMode === 'search' ? handleLineNumberClick : undefined}
          targetLineNumber={viewMode === 'context' ? contextData?.targetLine : undefined}
        />
      </div>
    </div>
  )
}

export default App
