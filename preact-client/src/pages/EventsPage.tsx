import type { EventPage as EventPageData, EventView, Level, Overview } from '@shared/api-types.ts'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Ansi } from '../components/Ansi'
import { Empty, ErrorBox, LevelBadge, Route, StackTrace } from '../components/ui'
import { api, useApi } from '../lib/api'
import { useEnv } from '../lib/settings'
import { duration, time } from '../lib/format'
import { appHref, eventHref, issueHref, Link, setQuery, useLocation } from '../lib/router'

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
  env?: string
  service?: string
  levels?: string
  q?: string
  reqId?: string
}

/** The event browser: filters live in the URL so a view can be shared or bookmarked. */
export function EventsPage() {
  const { query } = useLocation()
  const env = useEnv()
  const filter: EventFilter = {
    app: query.get('app') ?? undefined,
    env: env || undefined,
    service: query.get('service') ?? undefined,
    levels: query.get('levels') ?? undefined,
    q: query.get('q') ?? undefined,
    reqId: query.get('reqId') ?? undefined,
  }
  const [live, setLive] = useState(true)
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
        <EventList filter={filter} live={live} showApp={!filter.app} fill />
      </section>
    </div>
  )
}

function eventsUrl(
  filter: EventFilter,
  cursor: { before?: number; after?: number; limit?: number } = {},
) {
  const q = new URLSearchParams({ limit: String(cursor.limit ?? 100) })
  for (const [k, v] of Object.entries(filter)) if (v) q.set(k, v)
  if (cursor.before) q.set('before', String(cursor.before))
  if (cursor.after) q.set('after', String(cursor.after))
  return `/api/events?${q}`
}

function matchesText(e: EventView, q: string | undefined) {
  return !q || JSON.stringify(e).toLowerCase().includes(q.toLowerCase())
}

/** Most lines held while following; older ones are dropped and can be loaded again */
const MAX_EVENTS = 2000
/** Within this many pixels of the bottom counts as at the bottom */
const BOTTOM_SLACK = 40

/**
 * Events oldest first, like `tail -f`: opens at the newest, follows new events
 * while scrolled to the bottom, and loads older ones from the top. `fill` sizes
 * the pane to the rest of the viewport; otherwise it is a short scroll box.
 */
export function EventList({
  filter,
  live = false,
  showApp = false,
  compact = false,
  fill = false,
}: {
  filter: EventFilter
  live?: boolean
  showApp?: boolean
  compact?: boolean
  fill?: boolean
}) {
  const key = eventsUrl(filter)
  const [events, setEvents] = useState<EventView[]>([])
  const [older, setOlder] = useState<number | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [unseen, setUnseen] = useState(0)
  const [height, setHeight] = useState<number>()

  const paneRef = useRef<HTMLDivElement>(null)
  // Handlers outlive renders, so they read the list and position through refs
  const eventsRef = useRef(events)
  eventsRef.current = events
  const following = useRef(true)
  // How to place the scroll position once the next list renders
  const pendingScroll = useRef<'bottom' | { top: number; height: number } | null>(null)

  const show = (list: EventView[], scroll: typeof pendingScroll.current) => {
    pendingScroll.current = scroll
    eventsRef.current = list
    setEvents(list)
  }

  useLayoutEffect(() => {
    const el = paneRef.current
    const scroll = pendingScroll.current
    pendingScroll.current = null
    if (!el || !scroll) return
    el.scrollTop =
      scroll === 'bottom' ? el.scrollHeight : scroll.top + el.scrollHeight - scroll.height
  }, [events])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setUnseen(0)
    following.current = true
    api<EventPageData>(key, { signal: controller.signal })
      .then((page) => {
        show(page.events.reverse(), 'bottom')
        setOlder(page.nextBefore)
        setLoadedKey(key)
      })
      .catch((e: Error) => e.name !== 'AbortError' && setError(e))
      .finally(() => controller.signal.aborted || setLoading(false))
    return () => controller.abort()
  }, [key])

  /** Adds newer events, following them if at the bottom. */
  const append = (incoming: EventView[]) => {
    const list = eventsRef.current
    const held = new Set(list.map((e) => e.id))
    const fresh = incoming.filter((e) => !held.has(e.id))
    if (!fresh.length) return
    let next = list.concat(fresh)
    if (list.length && fresh.some((e) => e.id < list[list.length - 1].id)) {
      next.sort((a, b) => a.id - b.id)
    }
    if (!following.current) {
      setUnseen((n) => n + fresh.length)
      show(next, null)
      return
    }
    if (next.length > MAX_EVENTS) {
      next = next.slice(-MAX_EVENTS)
      setOlder(next[0].id)
    }
    show(next, 'bottom')
  }

  // Stream new events once the first page is in. Each (re)connect first
  // fetches what arrived since the newest event held, so none fall in a gap.
  useEffect(() => {
    if (!live || loadedKey !== key) return
    const q = new URLSearchParams()
    if (filter.app) q.set('app', filter.app)
    if (filter.env) q.set('env', filter.env)
    if (filter.service) q.set('service', filter.service)
    if (filter.levels) q.set('levels', filter.levels)
    const source = new EventSource(`/api/events/stream?${q}`, { withCredentials: true })
    let closed = false
    source.onopen = async () => {
      const list = eventsRef.current
      const newest = list[list.length - 1]?.id
      try {
        const page = await api<EventPageData>(eventsUrl(filter, { after: newest, limit: 500 }))
        if (closed) return
        if (page.nextBefore !== null && newest !== undefined) {
          // Too many to fill the gap: start over from the newest page
          following.current = true
          setUnseen(0)
          setOlder(page.nextBefore)
          show(page.events.reverse(), 'bottom')
        } else {
          append(page.events.reverse())
        }
      } catch {
        // The stream still delivers new events; only the gap is missing
      }
    }
    source.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as EventView
      if (!matchesText(e, filter.q) || (filter.reqId && e.reqId !== filter.reqId)) return
      append([e])
    }
    return () => {
      closed = true
      source.close()
    }
  }, [live, loadedKey, key])

  // The filter the list currently shows, so a page that lands after the
  // filter changed is dropped instead of added to the wrong list
  const keyRef = useRef(key)
  keyRef.current = key

  const loadOlder = async () => {
    if (older === null || loading) return
    const forKey = key
    setLoading(true)
    setError(null)
    try {
      const page = await api<EventPageData>(eventsUrl(filter, { before: older }))
      if (keyRef.current !== forKey) return
      const el = paneRef.current
      // Keep the lines on screen where they are as older ones go in above
      show(
        [...page.events.reverse(), ...eventsRef.current],
        el ? { top: el.scrollTop, height: el.scrollHeight } : null,
      )
      setOlder(page.nextBefore)
    } catch (e) {
      if (keyRef.current === forKey) setError(e as Error)
    } finally {
      setLoading(false)
    }
  }

  const onScroll = () => {
    const el = paneRef.current
    if (!el) return
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK
    if (following.current) setUnseen(0)
    if (el.scrollTop < 200 && older !== null && !loading && !error) loadOlder()
  }

  const toBottom = () => {
    const el = paneRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // Fill the viewport below the pane's top, leaving room for what follows it
  useLayoutEffect(() => {
    const el = paneRef.current
    if (!fill || !el) return
    const fit = () => {
      const pane = el.getBoundingClientRect()
      // Measured to the end of <main> (its padding, the card's border), not the
      // document, which is never shorter than the viewport
      const below = (el.closest('main') ?? el).getBoundingClientRect().bottom - pane.bottom
      setHeight(Math.max(320, window.innerHeight - (pane.top + window.scrollY) - below))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fill, key])

  return (
    <div class={compact ? 'events compact' : 'events'}>
      <div
        class={fill ? 'event-pane' : 'event-pane short'}
        ref={paneRef}
        style={height ? { height: `${height}px` } : undefined}
        onScroll={onScroll}
      >
        {error && !events.length ? (
          <ErrorBox error={error} />
        ) : !events.length ? (
          loading ? (
            <div class="loading">Loading…</div>
          ) : (
            <Empty>No matching events</Empty>
          )
        ) : (
          <>
            <div class="more">
              {older !== null ? (
                <button type="button" class="btn" disabled={loading} onClick={loadOlder}>
                  {loading ? 'Loading…' : error ? 'Retry' : 'Load older'}
                </button>
              ) : (
                <span class="muted small">Start of retained events</span>
              )}
            </div>
            {error && <ErrorBox error={error} />}
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
                    {showApp && (
                      <span class="event-app">
                        {e.app}
                        {e.service !== e.app && <span class="muted"> / {e.service}</span>}
                      </span>
                    )}
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
          </>
        )}
      </div>
      {unseen > 0 && (
        <button type="button" class="btn new-lines" onClick={toBottom}>
          {unseen} new {unseen === 1 ? 'line' : 'lines'} ↓
        </button>
      )}
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
