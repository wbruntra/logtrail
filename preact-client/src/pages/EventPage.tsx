import type { EventDetail, EventView } from '@shared/api-types.ts'
import type { ComponentChildren } from 'preact'
import { Ansi } from '../components/Ansi'
import { Card, Crumbs, LevelBadge, Loaded, Route, StackTrace } from '../components/ui'
import { useApi } from '../lib/api'
import { duration, fullTime, time } from '../lib/format'
import { appHref, eventHref, eventsHref, issueHref, Link } from '../lib/router'

export function EventPage({ id }: { id: number }) {
  const detail = useApi<EventDetail>(`/api/events/${id}`)
  return (
    <div class="page">
      <Loaded resource={detail}>{(d) => <EventDetailView d={d} />}</Loaded>
    </div>
  )
}

function EventDetailView({ d }: { d: EventDetail }) {
  const e = d.event
  const fields: [string, ComponentChildren][] = [
    ['Time', fullTime(e.ts)],
    ['Received', fullTime(e.receivedAt)],
    ['Request', (e.method || e.path) && <Route method={e.method} route={e.path} />],
    ['Route', e.route && <span class="mono">{e.route}</span>],
    ['Status', e.status && <span class={`status s${String(e.status)[0]}`}>{e.status}</span>],
    ['Duration', duration(e.duration)],
    ['Code', e.code && <code>{e.code}</code>],
    ['User', e.userId && <span class="mono">{e.userId}</span>],
    ['Release', e.release && <code>{e.release}</code>],
    [
      'Request id',
      e.reqId && (
        <Link class="mono" href={eventsHref({ reqId: e.reqId })}>
          {e.reqId}
        </Link>
      ),
    ],
    [
      'Issue',
      e.fingerprint && (
        <Link class="mono" href={issueHref(e.fingerprint)}>
          #{e.fingerprint}
        </Link>
      ),
    ],
  ]

  return (
    <>
      <Crumbs
        items={[
          { label: 'Overview', href: '/' },
          { label: e.app, href: appHref(e.app) },
          ...(e.fingerprint ? [{ label: 'Issue', href: issueHref(e.fingerprint) }] : []),
          { label: `Event ${e.id}` },
        ]}
      />
      <div class="issue-head">
        <div class="issue-head-title">
          <LevelBadge level={e.level} />
        </div>
        <h1 class="issue-msg">
          <Ansi text={e.msg} />
        </h1>
      </div>

      <div class="split">
        <div class="stack-col">
          {e.stack && (
            <Card title="Stack trace">
              <StackTrace stack={e.stack} />
            </Card>
          )}
          {e.extra && (
            <Card title="Extra fields">
              <pre class="json">{JSON.stringify(e.extra, null, 2)}</pre>
            </Card>
          )}
          {d.trace.length > 1 && (
            <Card title={`Request trace (${d.trace.length} events)`} flush>
              <Timeline events={d.trace} current={e.id} showApp />
            </Card>
          )}
          <Card
            title={`Around this event in ${e.app}`}
            flush
            actions={
              <Link class="btn small" href={eventsHref({ app: e.app })}>
                Open in events
              </Link>
            }
          >
            <Timeline events={[...d.before, e, ...d.after]} current={e.id} />
          </Card>
        </div>
        <Card title="Details">
          <dl class="fields">
            {fields
              .filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </Card>
      </div>
    </>
  )
}

/** Events in order, with the time offset from the first one. */
function Timeline({
  events,
  current,
  showApp,
}: {
  events: EventView[]
  current: number
  showApp?: boolean
}) {
  const start = Date.parse(events[0]?.ts ?? '')
  return (
    <ol class="event-list timeline">
      {events.map((t) => (
        <li key={t.id} class={t.id === current ? 'event current' : 'event'}>
          <Link class="event-row" href={eventHref(t.id)}>
            <span class="event-time" title={t.ts}>
              {showApp ? `+${Date.parse(t.ts) - start}ms` : time(t.ts)}
            </span>
            {showApp && <span class="event-app">{t.app}</span>}
            <LevelBadge level={t.level} />
            <span class="event-msg">
              <Ansi text={t.msg} />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  )
}
