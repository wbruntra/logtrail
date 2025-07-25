import React from 'react'
import type { SearchResult } from '../hooks/useBackendSearch'
import '../styles/search.css'

interface SearchResultsProps {
  results: SearchResult[]
  query: string
  isLoading: boolean
  onLineClick?: (lineNumber: number, content: string) => void
  onClose: () => void
}

const SearchResults: React.FC<SearchResultsProps> = ({
  results,
  query,
  isLoading,
  onLineClick,
  onClose
}) => {
  if (isLoading) {
    return (
      <div className="search-results-overlay">
        <div className="search-results-panel">
          <div className="search-results-header">
            <h5>Searching entire file...</h5>
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
          <div className="text-center p-4">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="search-results-overlay">
      <div className="search-results-panel">
        <div className="search-results-header">
          <h5>
            Search Results for "{query}" 
            <span className="badge bg-secondary ms-2">{results.length}</span>
          </h5>
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        
        <div className="search-results-content">
          {results.length === 0 ? (
            <div className="text-center text-muted p-4">
              No matches found in the entire file.
            </div>
          ) : (
            <div className="search-results-list">
              {results.map((result, index) => (
                <div
                  key={index}
                  className={`search-result-item ${onLineClick ? 'clickable' : ''}`}
                  onClick={() => onLineClick?.(result.lineNumber, result.content)}
                >
                  <div className="search-result-line-number">
                    Line {result.lineNumber}
                  </div>
                  <div className="search-result-content">
                    {result.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SearchResults
