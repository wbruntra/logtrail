import type { EventPage, EventView, IssueDetail, IssueState } from '@shared/api-types.ts'
import { useState } from 'preact/hooks'
import { Ansi } from '../components/Ansi'
import { BarList, ERROR_COLOR, StackedColumns, WARN_COLOR } from '../components/charts'
import {
  Ago,
  Card,
  Crumbs,
  Empty,
  ErrorBox,
  LevelBadge,
  Loaded,
  Route,
  StackTrace,
  Stat,
} from '../components/ui'
import { api, setIssueState, useApi } from '../lib/api'
import { duration, num, time } from '../lib/format'
import { appHref, eventHref, eventsHref, Link, rowLink } from '../lib/router'
import { useHours } from '../lib/settings'
import { useLoadMore } from '../lib/useLoadMore'

export function IssuePage({ fingerprint }: { fingerprint: string }) {
  const hours = useHours()
  const issue = useApi<IssueDetail>(`/api/issues/${fingerprint}?hours=${hours}`, { poll: 30_000 })
  return (
    <div class="page">
      <Loaded resource={issue}>{(d) => <IssueView d={d} reload={issue.reload} />}</Loaded>
    </div>
  )
}

function IssueView({ d, reload }: { d: IssueDetail; reload: () => void }) {
  const color = d.level === 'error' ? ERROR_COLOR : WARN_COLOR
  const series = [{ key: 'n', label: 'Occurrences', color, values: d.series }]
  const multiUser = d.breakdowns.users.length > 0

  return (
    <>
      <Crumbs
        items={[
          { label: 'Overview', href: '/' },
          { label: d.app, href: appHref(d.app) },
          { label: 'Issue' },
        ]}
      />
      <div class="issue-head">
        <div class="issue-head-title">
          <LevelBadge level={d.level} />
          {d.regressed && <span class="badge regressed">Regressed</span>}
          {d.isNew && !d.regressed && <span class="badge new">New</span>}
          <StateActions d={d} onChanged={reload} />
        </div>
        <h1 class="issue-msg">{d.msg}</h1>
        <div class="row-sub muted">
          <Route method={d.method} route={d.route} />
          {d.code && <code class="code">{d.code}</code>}
          {d.status && <span class={`status s${String(d.status)[0]}`}>{d.status}</span>}
          <span class="mono small" title="Fingerprint">
            #{d.fingerprint}
          </span>
        </div>
      </div>

      <StateBanner d={d} />

      <div class="stats">
        <Stat label="In window" value={num(d.count)} hint={`${num(d.totalCount)} retained`} />
        <Stat label="Users affected" value={num(d.users)} />
        <Stat label="First seen" value={<Ago ts={d.firstSeen} />} />
        <Stat label="Last seen" value={<Ago ts={d.lastSeen} />} />
      </div>

      <Card title="Occurrences">
        <StackedColumns
          window={d.window}
          series={series}
          height={140}
          empty="None in this window"
        />
      </Card>

      <div class="split">
        <div class="stack-col">
          {d.stack ? (
            <Card title="Latest stack trace">
              <StackTrace stack={d.stack} />
            </Card>
          ) : null}
          <Occurrences d={d} />
        </div>
        <div class="stack-col">
          <Card title="Releases">
            <BarList items={d.breakdowns.releases} label={(r) => <code>{r}</code>} />
          </Card>
          <Card title="Paths">
            <BarList items={d.breakdowns.paths} label={(p) => <span class="mono">{p}</span>} />
          </Card>
          {d.breakdowns.statuses.length > 0 && (
            <Card title="Status codes">
              <BarList items={d.breakdowns.statuses} />
            </Card>
          )}
          {multiUser && (
            <Card title="Users">
              <BarList items={d.breakdowns.users} label={(u) => <span class="mono">{u}</span>} />
            </Card>
          )}
        </div>
      </div>
    </>
  )
}

function Occurrences({ d }: { d: IssueDetail }) {
  // Pages past the first. The first page refreshes with the issue until older
  // pages are loaded; then it's frozen so a refresh can't open a gap at the seam.
  const [pages, setPages] = useState<EventPage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const events: EventView[] = pages.length ? pages.flatMap((p) => p.events) : d.occurrences.events
  const next = (pages.at(-1) ?? d.occurrences).nextBefore

  const loadOlder = async () => {
    if (next === null || loading) return
    setLoading(true)
    setError(null)
    try {
      const page = await api<EventPage>(`/api/issues/${d.fingerprint}/events?before=${next}`)
      setPages((loaded) => [...(loaded.length ? loaded : [d.occurrences]), page])
    } catch (e) {
      setError(e as Error)
    } finally {
      setLoading(false)
    }
  }
  const sentinel = useLoadMore<HTMLDivElement>(loadOlder, {
    enabled: next !== null && !loading && !error,
    count: events.length,
  })

  return (
    <Card title="Recent occurrences" flush>
      {events.length ? (
        <table class="table rows-link compact">
          <thead>
            <tr>
              <th>Time</th>
              <th>Request</th>
              <th class="hide-sm">User</th>
              <th class="hide-sm">Release</th>
              <th class="num hide-sm">Duration</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} onClick={rowLink(eventHref(e.id))}>
                <td class="nowrap">
                  <Link href={eventHref(e.id)}>{time(e.ts)}</Link>
                </td>
                <td class="truncate">
                  {e.path ? (
                    <span class="mono">{e.path}</span>
                  ) : (
                    <span class="muted">
                      <Ansi text={e.msg} />
                    </span>
                  )}
                </td>
                <td class="hide-sm mono">{e.userId ?? <span class="muted">–</span>}</td>
                <td class="hide-sm">
                  {e.release ? <code>{e.release}</code> : <span class="muted">–</span>}
                </td>
                <td class="num hide-sm">{duration(e.duration) ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>No occurrences retained</Empty>
      )}
      {error && <ErrorBox error={error} />}
      <div class="more" ref={sentinel}>
        {next !== null ? (
          <button type="button" class="btn" disabled={loading} onClick={loadOlder}>
            {loading ? 'Loading…' : error ? 'Retry' : 'Load older'}
          </button>
        ) : (
          <Link class="muted small" href={eventsHref({ app: d.app, levels: d.level })}>
            All {d.level === 'error' ? 'errors' : 'warnings'} in {d.app} →
          </Link>
        )}
      </div>
    </Card>
  )
}

function StateActions({ d, onChanged }: { d: IssueDetail; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const actions: { to: IssueState; label: string }[] =
    d.state === 'open'
      ? [
          { to: 'resolved', label: 'Resolve' },
          { to: 'muted', label: 'Mute' },
        ]
      : d.state === 'resolved'
        ? [
            { to: 'open', label: 'Reopen' },
            { to: 'muted', label: 'Mute' },
          ]
        : [{ to: 'open', label: 'Unmute' }]

  const apply = async (to: IssueState) => {
    setBusy(true)
    setError(null)
    try {
      await setIssueState([d.fingerprint], to)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="state-actions">
      {error && <span class="error-text small">{error}</span>}
      {actions.map((a) => (
        <button
          key={a.to}
          type="button"
          class="btn small"
          disabled={busy}
          onClick={() => apply(a.to)}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

function StateBanner({ d }: { d: IssueDetail }) {
  if (d.regressed) {
    return (
      <div class="state-banner regressed">
        Resolved <Ago ts={d.stateChangedAt} />, then happened again.
      </div>
    )
  }
  if (d.state === 'resolved') {
    return (
      <div class="state-banner">
        Resolved <Ago ts={d.stateChangedAt} />. It reopens if it happens again.
      </div>
    )
  }
  if (d.state === 'muted') {
    return (
      <div class="state-banner">
        Muted <Ago ts={d.stateChangedAt} />. Its events are left out of dashboard counts and charts.
      </div>
    )
  }
  return null
}
