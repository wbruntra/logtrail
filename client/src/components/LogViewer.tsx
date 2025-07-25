import React from 'react'
import AutoScrollButton from './AutoScrollButton'
import LoadingIndicator from './LoadingIndicator'

interface LogViewerProps {
  logs: string[]
  autoScroll: boolean
  onAutoScrollChange: (enabled: boolean) => void
  onScroll: () => void
  loadingHistory: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
}

const LogViewer: React.FC<LogViewerProps> = ({
  logs,
  autoScroll,
  onAutoScrollChange,
  onScroll,
  loadingHistory,
  containerRef
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
        {logs.map((log, index) => (
          <div key={index}>{log}</div>
        ))}
      </pre>
      <AutoScrollButton
        autoScroll={autoScroll}
        onToggle={handleAutoScrollToggle}
      />
    </div>
  )
}

export default LogViewer
