import React from 'react'

interface SearchBarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  onClearSearch: () => void
  isSearching: boolean
  matchCount: number
}

const SearchBar: React.FC<SearchBarProps> = ({
  searchQuery,
  onSearchChange,
  onClearSearch,
  isSearching,
  matchCount,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      onClearSearch()
    }
  }

  return (
    <div className="search-bar-container">
      <div className="input-group">
        <span className="input-group-text">
          {isSearching ? (
            <span className="spinner-border spinner-border-sm text-secondary" role="status" />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 16 16"
            >
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0" />
            </svg>
          )}
        </span>
        <input
          type="text"
          className="form-control"
          placeholder="Search logs... (supports regex)"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {searchQuery && (
          <button
            className="btn btn-outline-secondary"
            type="button"
            onClick={onClearSearch}
            title="Clear search"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 16 16"
            >
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
            </svg>
          </button>
        )}
      </div>

      {searchQuery && !isSearching && (
        <div className="search-info">
          <small className="text-muted">
            {matchCount === 0 ? 'No matches found' : `${matchCount} match${matchCount === 1 ? '' : 'es'} in file`}
          </small>
        </div>
      )}
    </div>
  )
}

export default SearchBar
