import React, { useEffect } from 'react'
import App from './App'
import LoginForm from './LoginForm'
import { useUser } from './UserContext'

const Controller: React.FC = () => {
  const { user, setUser } = useUser()
  const [loading, setLoading] = React.useState(true)

  useEffect(() => {
    fetch('/api/status', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
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
  return <App />
}

export default Controller