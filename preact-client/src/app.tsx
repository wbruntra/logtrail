import { useEffect, useState } from 'preact/hooks'
import { EnvPicker, WindowPicker } from './components/ui'
import { checkStatus, login, logout, useAuthenticated } from './lib/auth'
import { Link, match, useLocation } from './lib/router'
import { AppPage } from './pages/AppPage'
import { EventPage } from './pages/EventPage'
import { EventsPage } from './pages/EventsPage'
import { IssuePage } from './pages/IssuePage'
import { Overview } from './pages/Overview'
import { SetupPage } from './pages/SetupPage'

export function App() {
  const authenticated = useAuthenticated()
  useEffect(() => void checkStatus(), [])

  if (authenticated === null) return <div class="loading full">Loading…</div>
  if (!authenticated) return <Login />
  return <Shell />
}

function Shell() {
  const { path } = useLocation()
  let page
  let params: Record<string, string> | null
  let section: 'overview' | 'events' | 'setup' = 'overview'
  if (path === '/' || path === '') page = <Overview />
  else if ((params = match('/apps/:app', path)))
    page = <AppPage key={params.app} app={params.app} />
  else if ((params = match('/issues/:fingerprint', path)))
    page = <IssuePage key={params.fingerprint} fingerprint={params.fingerprint} />
  else if ((params = match('/events/:id', path)) && /^\d+$/.test(params.id)) {
    page = <EventPage key={params.id} id={Number(params.id)} />
    section = 'events'
  } else if (match('/setup', path)) {
    page = <SetupPage />
    section = 'setup'
  } else if (match('/events', path)) {
    page = <EventsPage />
    section = 'events'
  } else page = <NotFound />

  return (
    <>
      <header class="topbar">
        <Link class="brand" href="/">
          <img src="/favicon.svg" alt="" width={20} height={20} />
          logtrail
        </Link>
        <nav class="nav">
          <Link href="/" aria-current={section === 'overview' ? 'page' : undefined}>
            Overview
          </Link>
          <Link href="/events" aria-current={section === 'events' ? 'page' : undefined}>
            Events
          </Link>
          <Link href="/setup" aria-current={section === 'setup' ? 'page' : undefined}>
            Setup
          </Link>
        </nav>
        <div class="topbar-right">
          <EnvPicker />
          <WindowPicker />
          <button type="button" class="btn ghost small" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>
      <main>{page}</main>
    </>
  )
}

function NotFound() {
  return (
    <div class="page">
      <div class="empty">
        Nothing here. <Link href="/">Back to the overview</Link>
      </div>
    </div>
  )
}

function Login() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div class="login">
      <form
        class="card login-card"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(await login(password))
          setBusy(false)
        }}
      >
        <div class="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          logtrail
        </div>
        <label class="field">
          <span>Password</span>
          <input
            class="input"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </label>
        {error && <div class="error-box">{error}</div>}
        <button class="btn primary" type="submit" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
