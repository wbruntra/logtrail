import React from 'react'
import type { LogFile } from '../types/logTypes'
import { useUser } from '../UserContext'

interface HeaderProps {
  logFiles: LogFile[]
  selectedLog: string
  onLogChange: (logPath: string) => void
}

const Header: React.FC<HeaderProps> = ({ logFiles, selectedLog, onLogChange }) => {
  const { setUser } = useUser()

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/logout', {
        credentials: 'include',
      })
      
      if (response.ok) {
        setUser(null) // This will trigger the Controller to show the login form
      } else {
        console.error('Logout failed')
      }
    } catch (error) {
      console.error('Error during logout:', error)
    }
  }

  return (
    <header className="App-header">
      <div className="container">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h1 className="display-5 mb-0">Logtrail</h1>
          <button
            className="btn btn-outline-light"
            onClick={handleLogout}
            type="button"
          >
            Logout
          </button>
        </div>
        <div className="mb-3">
          <label htmlFor="log-select" className="form-label me-2">Select log file:</label>
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
      </div>
    </header>
  )
}

export default Header
