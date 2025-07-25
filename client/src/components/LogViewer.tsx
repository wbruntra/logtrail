import React from 'react'
import AutoScrollButton from './AutoScrollButton'
import LoadingIndicator from './LoadingIndicator'
import { parseLogLine, getLogLineClass } from '../utils/logParser'
import { highlightSearchMatches } from '../utils/searchHighlight'
import type { LogLine } from '../types/logTypes'
import '../styles/logLevels.css'
import '../styles/search.css'

interface LogViewerProps {
  logs: LogLine[]
  autoScroll: boolean
  onAutoScrollChange: (enabled: boolean) => void
  onScroll: () => void
  loadingHistory: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  searchQuery?: string
  debouncedQuery?: string
  onLineClick?: (lineNumber: number, content: string) => void
}

const LogViewer: React.FC<LogViewerProps> = ({
  logs,
  autoScroll,
  onAutoScrollChange,
  onScroll,
  loadingHistory,
  containerRef,
  searchQuery = '',
  debouncedQuery = '',
  onLineClick
}) => {
  const handleAutoScrollToggle = () => {
    if (!autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
    onAutoScrollChange(!autoScroll)
  }

  return (
    <div className="log-container" ref={containerRef} onScroll={onScroll}>
      {loadingHistory && <LoadingIndicator />}
      <pre className="mb-0">
        {logs.map((logLine, index) => {
          const parsedLog = parseLogLine(logLine.content)
          const lineClass = getLogLineClass(parsedLog.level)
          const searchHighlights = highlightSearchMatches(logLine.content, debouncedQuery)
          
          const handleLineClick = () => {
            if (onLineClick) {
              onLineClick(logLine.lineNumber, logLine.content)
            }
          }
          
          return (
            <div 
              key={index} 
              className={`${lineClass} ${onLineClick ? 'log-line-clickable' : ''}`}
              onClick={handleLineClick}
              title={onLineClick ? `Line ${logLine.lineNumber} - Click for context` : undefined}
            >
              <span className="log-line-number">{logLine.lineNumber}</span>
              {debouncedQuery ? (
                // Render with search highlighting
                searchHighlights.map((highlight, highlightIndex) => (
                  highlight.isMatch ? (
                    <span key={highlightIndex} className="search-highlight">
                      {highlight.text}
                    </span>
                  ) : (
                    <span key={highlightIndex}>{highlight.text}</span>
                  )
                ))
              ) : (
                // Render with log level highlighting only
                parsedLog.segments.map((segment, segIndex) => (
                  segment.className ? (
                    <span key={segIndex} className={segment.className}>
                      {segment.text}
                    </span>
                  ) : (
                    <span key={segIndex}>{segment.text}</span>
                  )
                ))
              )}
            </div>
          )
        })}
      </pre>
      <AutoScrollButton
        autoScroll={autoScroll}
        onToggle={handleAutoScrollToggle}
      />
    </div>
  )
}

export default LogViewer
