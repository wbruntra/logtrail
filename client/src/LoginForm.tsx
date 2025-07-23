import React, { useState } from 'react'
import { useUser } from './UserContext'

interface LoginFormProps {
  onLoginSuccess?: () => void
}

const LoginForm: React.FC<LoginFormProps> = ({ onLoginSuccess }) => {
  const { setUser } = useUser()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
      })
      const data = await res.json()
      if (res.ok && data.authenticated) {
        setUser({ username: 'user', authenticated: true })
        if (onLoginSuccess) onLoginSuccess()
      } else {
        setError(data.error || 'Login failed')
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container" style={{ maxWidth: 400, marginTop: 80 }}>
      <h2 className="mb-4">Log in to Logtrail</h2>
      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label htmlFor="password" className="form-label">Password</label>
          <input
            type="password"
            className="form-control"
            id="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={loading}
            autoFocus
            required
          />
        </div>
        {error && <div className="alert alert-danger py-1">{error}</div>}
        <button type="submit" className="btn btn-primary w-100" disabled={loading}>
          {loading ? 'Logging in...' : 'Log In'}
        </button>
      </form>
    </div>
  )
};

export default LoginForm;
