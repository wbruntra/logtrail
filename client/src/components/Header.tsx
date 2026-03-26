import React from 'react'
import { NavLink } from 'react-router-dom'
import type { LogFile } from '../types/logTypes'
import { useUser } from '../UserContext'
import SearchBar from './SearchBar'

interface HeaderProps {
  // Log-viewer specific — omit these on the Dashboard page
  logFiles?: LogFile[]
  selectedLog?: string
  onLogChange?: (logPath: string) => void
  searchQuery?: string
  onSearchChange?: (query: string) => void
  onClearSearch?: () => void
  isSearching?: boolean
  matchCount?: number
  // Optional extra controls rendered after the nav (e.g. time range picker)
  controls?: React.ReactNode
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `btn btn-sm ${isActive ? 'btn-light' : 'btn-outline-light'}`

const Header: React.FC<HeaderProps> = ({
  logFiles,
  selectedLog,
  onLogChange,
  searchQuery = '',
  onSearchChange,
  onClearSearch,
  isSearching = false,
  matchCount = 0,
  controls,
}) => {
  const { logout } = useUser()

  const handleLogout = async () => {
    const token = localStorage.getItem('token')
    try {
      const response = await fetch('/api/logout', {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        credentials: 'include',
      })
      localStorage.removeItem('token')
      if (response.ok) logout()
      else console.error('Logout failed')
    } catch {
      localStorage.removeItem('token')
    }
  }

  const showLogControls = logFiles && onLogChange && onSearchChange && onClearSearch

  return (
    <header className="App-header">
      <div className="container">
        {/* Brand + nav + logout */}
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h1 className="display-5 mb-0">Logtrail</h1>
          <div className="d-flex align-items-center gap-3">
            <nav className="d-flex gap-2">
              <NavLink to="/logs" className={navLinkClass}>Logs</NavLink>
              <NavLink to="/dashboard" className={navLinkClass}>Dashboard</NavLink>
            </nav>
            {controls}
            <button className="btn btn-outline-light" onClick={handleLogout} type="button">
              Logout
            </button>
          </div>
        </div>

        {/* Log-viewer controls */}
        {showLogControls && (
          <>
            <div className="mb-3">
              <label htmlFor="log-select" className="form-label me-2">
                Select log file:
              </label>
              <select
                id="log-select"
                className="form-select d-inline-block w-auto"
                value={selectedLog}
                onChange={(e) => onLogChange(e.target.value)}
              >
                {logFiles.map((log) => (
                  <option key={log.path} value={log.path}>
                    {log.name} {log.description ? `- ${log.description}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <SearchBar
              searchQuery={searchQuery}
              onSearchChange={onSearchChange}
              onClearSearch={onClearSearch}
              isSearching={isSearching}
              matchCount={matchCount}
            />
          </>
        )}
      </div>
    </header>
  )
}

export default Header
