import type { EventPage as EventPageData, EventView, Level, Overview } from '@shared/api-types.ts'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Ansi } from '../components/Ansi'
import { Empty, ErrorBox, LevelBadge, Route, StackTrace } from '../components/ui'
import { api, useApi } from '../lib/api'
import { duration, time } from '../lib/format'
import { appHref, eventHref, issueHref, Link, setQuery, useLocation } from '../lib/router'
import { useLoadMore } from '../lib/useLoadMore'

const LEVEL_CHIPS: { key: Level | 'none'; label: string }[] = [
  { key: 'error', label: 'Error' },
  { key: 'warn', label: 'Warn' },
  { key: 'info', label: 'Info' },
  { key: 'debug', label: 'Debug' },
  { key: 'success', label: 'OK' },
  { key: 'none', label: 'Raw' },
]

export interface EventFilter {
  app?: string
  levels?: string
  q?: string
  reqId?: string
}

/** The event browser: filters live in the URL so a view can be shared or bookmarked. */
export function EventsPage() {
  const { query } = useLocation()
  const filter: EventFilter = {
    app: query.get('app') ?? undefined,
    levels: query.get('levels') ?? undefined,
    q: query.get('q') ?? undefined,
    reqId: query.get('reqId') ?? undefined,
  }
  const [live, setLive] = useState(false)
  const apps = useApi<Overview>('/api/apps?hours=1')
  const [text, setText] = useState(filter.q ?? '')
  const searchRef = useRef<HTMLInputElement>(null)

  // Debounce typing into the URL
  useEffect(() => {
    const t = setTimeout(() => setQuery({ q: text.trim() }), 300)
    return () => clearTimeout(t)
  }, [text])

  // "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as Element).closest('input, textarea, select')) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const levels = new Set(filter.levels?.split(',').filter(Boolean))
  const toggleLevel = (key: string) => {
    if (levels.has(key)) levels.delete(key)
    else levels.add(key)
    setQuery({ levels: [...levels].join(',') })
  }

  return (
    <div class="page">
      <div class="page-head">
        <h1>Events</h1>
        {filter.app && (
          <Link class="btn" href={appHref(filter.app)}>
            {filter.app} health
          </Link>
        )}
      </div>

      <div class="filters">
        <select
          class="select"
          aria-label="App"
          value={filter.app ?? ''}
          onChange={(e) => setQuery({ app: e.currentTarget.value })}
        >
          <option value="">All apps</option>
          {apps.data?.apps.map((a) => (
            <option key={a.app} value={a.app}>
              {a.app}
            </option>
          ))}
          {filter.app && !apps.data?.apps.some((a) => a.app === filter.app) && (
            <option value={filter.app}>{filter.app}</option>
          )}
        </select>
        <div class="chips" role="group" aria-label="Levels">
          {LEVEL_CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              class={`chip level-chip-${c.key}`}
              aria-pressed={levels.has(c.key)}
              onClick={() => toggleLevel(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          ref={searchRef}
          class="input search"
          type="search"
          placeholder="Search text, ids, paths…  ( / )"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <label class="toggle">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.currentTarget.checked)}
          />
          Live
        </label>
      </div>
      {filter.reqId && (
        <div class="filter-note">
          Request <code>{filter.reqId}</code>
          <button type="button" class="btn small" onClick={() => setQuery({ reqId: null })}>
            Clear
          </button>
        </div>
      )}

      <section class="card">
        <EventList filter={filter} live={live} showApp={!filter.app} />
      </section>
    </div>
  )
}

function eventsUrl(filter: EventFilter, before?: number) {
  const q = new URLSearchParams({ limit: '100' })
  for (const [k, v] of Object.entries(filter)) if (v) q.set(k, v)
  if (before) q.set('before', String(before))
  return `/api/events?${q}`
}

function matchesText(e: EventView, q: string | undefined) {
  return !q || JSON.stringify(e).toLowerCase().includes(q.toLowerCase())
}

/** A newest-first list of events with "load older" paging and an optional live tail. */
export function EventList({
  filter,
  live = false,
  showApp = false,
  compact = false,
}: {
  filter: EventFilter
  live?: boolean
  showApp?: boolean
  compact?: boolean
}) {
  const key = eventsUrl(filter)
  const [events, setEvents] = useState<EventView[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    api<EventPageData>(key, { signal: controller.signal })
      .then((page) => {
        setEvents(page.events)
        setNext(page.nextBefore)
      })
      .catch((e: Error) => e.name !== 'AbortError' && setError(e))
      .finally(() => controller.signal.aborted || setLoading(false))
    return () => controller.abort()
  }, [key])

  useEffect(() => {
    if (!live) return
    const q = new URLSearchParams()
    if (filter.app) q.set('app', filter.app)
    if (filter.levels) q.set('levels', filter.levels)
    const source = new EventSource(`/api/events/stream?${q}`, { withCredentials: true })
    source.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as EventView
      if (!matchesText(e, filter.q) || (filter.reqId && e.reqId !== filter.reqId)) return
      setEvents((list) => [e, ...list].slice(0, 2000))
    }
    return () => source.close()
  }, [live, filter.app, filter.levels, filter.q, filter.reqId])

  // The filter the list currently shows, so a page that lands after the
  // filter changed is dropped instead of appended to the wrong list
  const keyRef = useRef(key)
  keyRef.current = key

  const loadOlder = async () => {
    if (next === null || loading) return
    const forKey = key
    setLoading(true)
    setError(null)
    try {
      const page = await api<EventPageData>(eventsUrl(filter, next))
      if (keyRef.current !== forKey) return
      setEvents((list) => [...list, ...page.events])
      setNext(page.nextBefore)
    } catch (e) {
      if (keyRef.current === forKey) setError(e as Error)
    } finally {
      setLoading(false)
    }
  }
  const sentinel = useLoadMore<HTMLDivElement>(loadOlder, {
    enabled: next !== null && !loading && !error,
    count: events.length,
  })

  if (error && !events.length) return <ErrorBox error={error} />
  if (!events.length) {
    return loading ? <div class="loading">Loading…</div> : <Empty>No matching events</Empty>
  }

  return (
    <div class={compact ? 'events compact' : 'events'}>
      {live && <div class="live-note">Live: new events appear at the top</div>}
      <ol class="event-list">
        {events.map((e) => (
          <li key={e.id} class={open === e.id ? 'event open' : 'event'}>
            <button
              type="button"
              class="event-row"
              aria-expanded={open === e.id}
              onClick={() => setOpen(open === e.id ? null : e.id)}
            >
              <span class="event-time" title={e.ts}>
                {time(e.ts)}
              </span>
              {showApp && <span class="event-app">{e.app}</span>}
              <LevelBadge level={e.level} />
              <span class="event-msg">
                {e.status !== null && (
                  <span class={`status s${String(e.status)[0]}`}>{e.status}</span>
                )}
                <Ansi text={e.msg} />
              </span>
            </button>
            {open === e.id && <EventInline e={e} />}
          </li>
        ))}
      </ol>
      {error && <ErrorBox error={error} />}
      <div class="more" ref={sentinel}>
        {next !== null ? (
          <button type="button" class="btn" disabled={loading} onClick={loadOlder}>
            {loading ? 'Loading…' : error ? 'Retry' : 'Load older'}
          </button>
        ) : (
          <span class="muted small">End of retained events</span>
        )}
      </div>
    </div>
  )
}

function EventInline({ e }: { e: EventView }) {
  return (
    <div class="event-inline">
      <div class="kv">
        {(e.method || e.path) && (
          <span>
            <Route method={e.method} route={e.path} />
          </span>
        )}
        {e.code && <code class="code">{e.code}</code>}
        {e.duration !== null && <span>{duration(e.duration)}</span>}
        {e.userId && <span>user {e.userId}</span>}
        {e.release && <span>release {e.release}</span>}
        {e.reqId && <span>req {e.reqId}</span>}
      </div>
      {e.stack && <StackTrace stack={e.stack} />}
      {e.extra && <pre class="json">{JSON.stringify(e.extra, null, 2)}</pre>}
      <div class="event-inline-actions">
        <Link class="btn small" href={eventHref(e.id)}>
          Open event
        </Link>
        {e.fingerprint && (
          <Link class="btn small" href={issueHref(e.fingerprint)}>
            Open issue
          </Link>
        )}
      </div>
    </div>
  )
}
