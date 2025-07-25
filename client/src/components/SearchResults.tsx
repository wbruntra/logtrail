import React from 'react'
import { Modal } from 'react-bootstrap'
import type { SearchResult } from '../hooks/useBackendSearch'
import { parseLogLine, getLogLineClass } from '../utils/logParser'
import '../styles/search.css'
import '../styles/modals.css'

interface SearchResultsProps {
  results: SearchResult[]
  query: string
  isLoading: boolean
  onLineClick?: (lineNumber: number, content: string) => void
  onClose: () => void
  show: boolean
}

const SearchResults: React.FC<SearchResultsProps> = ({
  results,
  query,
  isLoading,
  onLineClick,
  onClose,
  show
}) => {
  return (
    <Modal 
      show={show} 
      onHide={onClose}
      size="lg"
      centered
      dialogClassName="search-modal"
      data-bs-theme="dark"
    >
      <Modal.Header closeButton>
        <Modal.Title>
          {isLoading ? (
            'Searching entire file...'
          ) : (
            <>
              Search Results for "{query}" 
              <span className="badge bg-secondary ms-2">{results.length}</span>
            </>
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
        ) : results.length === 0 ? (
          <div className="text-center text-muted p-4">
            No matches found in the entire file.
          </div>
        ) : (
          <div className="search-results-list">
            {results.map((result, index) => {
              const parsedLine = parseLogLine(result.content)
              return (
                <div
                  key={index}
                  className={`search-result-item ${onLineClick ? 'clickable' : ''} ${getLogLineClass(parsedLine.level)}`}
                  onClick={() => onLineClick?.(result.lineNumber, result.content)}
                >
                  <div className="search-result-line-number">
                    Line {result.lineNumber}
                  </div>
                  <div className="search-result-content">
                    {parsedLine.segments.map((segment, segIndex) => (
                      <span 
                        key={segIndex}
                        className={segment.className}
                      >
                        {segment.text}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Modal.Body>
    </Modal>
  )
}

export default SearchResults
