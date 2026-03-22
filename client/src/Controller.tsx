import React, { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import App from './App'
import Dashboard from './components/Dashboard'
import LoginForm from './LoginForm'
import { useUser } from './UserContext'

const Controller: React.FC = () => {
  const { user, setUser } = useUser()
  const [loading, setLoading] = React.useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    fetch('/api/status', {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          setUser({ username: '', authenticated: true })
        } else {
          setUser(null)
        }
        setLoading(false)
      })
      .catch(() => {
        setUser(null)
        setLoading(false)
      })
  }, [setUser])

  if (loading) {
    return <div>Loading...</div>
  }
  if (!user || !user.authenticated) {
    return <LoginForm onLoginSuccess={() => setUser({ username: '', authenticated: true })} />
  }

  return (
    <Routes>
      <Route path="/logs" element={<App />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="*" element={<Navigate to="/logs" replace />} />
    </Routes>
  )
}

export default Controller
