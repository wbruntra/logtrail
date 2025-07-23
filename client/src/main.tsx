import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { UserProvider } from './UserContext'
import Controller from './Controller'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UserProvider>
      <Controller />
    </UserProvider>
  </StrictMode>,
)
