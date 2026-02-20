import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { UserProvider } from './UserContext'
import Controller from './Controller'

// @ts-ignore
const originalFetch = window.fetch
// @ts-ignore
window.fetch = async function (...args) {
  // @ts-ignore
  const response = await originalFetch.apply(this, args)
  if (response.status === 401) {
    localStorage.removeItem('token')
    window.dispatchEvent(new Event('auth-expired'))
  }
  return response
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UserProvider>
      <Controller />
    </UserProvider>
  </StrictMode>,
)
