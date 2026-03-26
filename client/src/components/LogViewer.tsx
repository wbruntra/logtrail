import React from 'react'
import AutoScrollButton from './AutoScrollButton'
import LoadingIndicator from './LoadingIndicator'
import { parseLogLine, getLogLineClass, tryParseStructured } from '../utils/logParser'
import { highlightSearchMatches } from '../utils/searchHighlight'
import type { LogLine, StructuredEvent } from '../types/logTypes'
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
  onLineNumberClick?: (lineNumber: number) => void
  targetLineNumber?: number
}

const STRUCTURED_LINE_CLASS: Record<StructuredEvent['level'], string> = {
  error: 'log-line-error',
  warn: 'log-line-warning',
  info: 'log-line-info',
  debug: 'log-line-debug',
  success: 'log-line-success',
}

function formatTime(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString('en-US', { hour12: false })
  } catch {
    return isoStr.slice(11, 19)
  }
}

const LogViewer: React.FC<LogViewerProps> = ({
  logs,
  autoScroll,
  onAutoScrollChange,
  onScroll,
  loadingHistory,
  containerRef,
  debouncedQuery = '',
  onLineNumberClick,
  targetLineNumber,
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
          const structured = tryParseStructured(logLine.content)

          const isTarget = targetLineNumber !== undefined && logLine.lineNumber === targetLineNumber

          if (structured) {
            const lineClass = STRUCTURED_LINE_CLASS[structured.level] ?? 'log-line-default'
            const msgHighlights = debouncedQuery
              ? highlightSearchMatches(structured.msg, debouncedQuery)
              : null

            return (
              <div key={index} className={`${lineClass} structured-event${isTarget ? ' log-line-target' : ''}`}>
                <span
                  className={`log-line-number${onLineNumberClick ? ' log-line-number-clickable' : ''}`}
                  onClick={() => onLineNumberClick?.(logLine.lineNumber)}
                >
                  {logLine.lineNumber}
                </span>
                <span className="structured-time">{formatTime(structured.ts)}</span>
                <span className={`structured-level structured-level-${structured.level}`}>
                  {structured.level.toUpperCase()}
                </span>
                {structured.code && (
                  <span className="structured-code">{structured.code}</span>
                )}
                <span className="structured-msg">
                  {msgHighlights
                    ? msgHighlights.map((h, i) =>
                        h.isMatch
                          ? <span key={i} className="search-highlight">{h.text}</span>
                          : <span key={i}>{h.text}</span>
                      )
                    : structured.msg}
                </span>
                <span className="structured-meta">
                  {structured.method && structured.status !== undefined && (
                    <span className="structured-pill">{structured.method} {structured.status}</span>
                  )}
                  {structured.duration !== undefined && (
                    <span className="structured-pill">{structured.duration}ms</span>
                  )}
                  {structured.reqId && (
                    <span className="structured-pill structured-reqid">req:{structured.reqId}</span>
                  )}
                </span>
              </div>
            )
          }

          // Plain text line
          const parsedLog = parseLogLine(logLine.content)
          const lineClass = getLogLineClass(parsedLog.level)
          const searchHighlights = highlightSearchMatches(logLine.content, debouncedQuery)

          return (
            <div key={index} className={`${lineClass}${isTarget ? ' log-line-target' : ''}`}>
              <span
                className={`log-line-number${onLineNumberClick ? ' log-line-number-clickable' : ''}`}
                onClick={() => onLineNumberClick?.(logLine.lineNumber)}
              >
                {logLine.lineNumber}
              </span>
              {debouncedQuery ? (
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
