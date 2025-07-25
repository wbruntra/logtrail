import { useEffect, useCallback, useState } from 'react'
import './App.scss'
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
    historyLoadLock 
  } = useLogHistory()
  
  const { 
    autoScroll, 
    setAutoScroll, 
    handleScroll: baseHandleScroll, 
    containerRef,
    scrollRestoreRef
  } = useAutoScroll(logs)

  // Search functionality
  const {
    searchQuery,
    setSearchQuery,
    filteredLogs,
    isSearching,
    matchCount,
    clearSearch,
    debouncedQuery
  } = useLogSearch(logs)

  // Backend search functionality
  const {
    searchResults,
    contextData,
    isSearching: isBackendSearching,
    isLoadingContext,
    searchFile,
    getContext,
    clearResults,
    clearContext
  } = useBackendSearch()

  // State for showing search results
  const [showSearchResults, setShowSearchResults] = useState(false)

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

  // Handle line click to get context
  const handleLineClick = useCallback(async (lineNumber: number) => {
    if (selectedLog) {
      await getContext(selectedLog, lineNumber, 20)
    }
  }, [selectedLog, getContext])

  // Handle backend search
  const handleBackendSearch = useCallback(async (query: string) => {
    if (selectedLog) {
      await searchFile(selectedLog, query)
      setShowSearchResults(true)
    }
  }, [selectedLog, searchFile])

  // Handle search result line click
  const handleSearchResultClick = useCallback(async (lineNumber: number, _content: string) => {
    setShowSearchResults(false)
    if (selectedLog) {
      await getContext(selectedLog, lineNumber, 20)
    }
  }, [selectedLog, getContext])

  // Close search results
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
          onLineClick={handleLineClick}
        />
      </div>
      
      {showSearchResults && (
        <SearchResults
          results={searchResults}
          query={searchQuery}
          isLoading={isBackendSearching}
          onLineClick={handleSearchResultClick}
          onClose={handleCloseSearchResults}
        />
      )}
      
      {(contextData || isLoadingContext) && (
        <div className="context-overlay">
          <div className="context-panel">
            <div className="context-header">
              <h5>
                {isLoadingContext ? 'Loading Context...' : `Context for Line ${contextData?.targetLine}`}
              </h5>
              <button
                className="btn btn-sm btn-outline-secondary"
                onClick={() => clearContext()}
              >
                Close
              </button>
            </div>
            <div className="context-content">
              {isLoadingContext ? (
                <div className="text-center p-3">
                  <div className="spinner-border" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                </div>
              ) : (
                <pre>
                  {contextData?.lines.map((line, index) => (
                    <div 
                      key={index}
                      className={`context-line ${line.isTarget ? 'target-line' : ''}`}
                    >
                      <span className="context-line-number">{line.lineNumber}</span>
                      {line.content}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
