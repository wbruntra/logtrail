import React from 'react'
import { Modal } from 'react-bootstrap'
import type { ContextResponse } from '../hooks/useBackendSearch'
import { parseLogLine, getLogLineClass } from '../utils/logParser'
import '../styles/modals.css'

interface ContextViewerProps {
  contextData: ContextResponse | null
  isLoading: boolean
  show: boolean
  onBack: () => void
  onClose: () => void
}

const ContextViewer: React.FC<ContextViewerProps> = ({
  contextData,
  isLoading,
  show,
  onBack,
  onClose,
}) => {
  return (
    <Modal
      show={show}
      onHide={onClose}
      size="lg"
      centered
      dialogClassName="context-modal"
      data-bs-theme="dark"
    >
      <Modal.Header closeButton>
        <Modal.Title>
          {isLoading ? (
            'Loading context...'
          ) : contextData ? (
            <>
              Context around line {contextData.targetLine}
              <span className="text-muted ms-2" style={{ fontSize: '0.85em' }}>
                (lines {contextData.startLine}–{contextData.endLine})
              </span>
            </>
          ) : (
            'Context'
          )}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {isLoading ? (
          <div className="text-center p-4">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        ) : contextData ? (
          <div className="search-results-list context-content">
            {contextData.lines.map((line, index) => {
              const parsedLine = parseLogLine(line.content)
              return (
                <div
                  key={index}
                  className={`search-result-item ${getLogLineClass(parsedLine.level)}${line.isTarget ? ' context-target-line' : ''}`}
                >
                  <div className="search-result-line-number">
                    Line {line.lineNumber}
                    {line.isTarget && (
                      <span className="ms-2 badge bg-warning text-dark">match</span>
                    )}
                  </div>
                  <div className="search-result-content">
                    {parsedLine.segments.map((segment, segIndex) => (
                      <span key={segIndex} className={segment.className}>
                        {segment.text}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </Modal.Body>
      <Modal.Footer style={{ borderTop: '1px solid var(--bs-border-color)', backgroundColor: 'var(--bs-tertiary-bg)' }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>
          ← Back to results
        </button>
      </Modal.Footer>
    </Modal>
  )
}

export default ContextViewer
