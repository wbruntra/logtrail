import type { AppDetail, IssueSummary } from '@shared/api-types.ts'
import { alertSeries, BarList, Legend, StackedColumns, VOLUME_COLOR } from '../components/charts'
import { IssuesCard } from '../components/IssuesCard'
import { Ago, Card, Crumbs, Empty, Loaded, Route, Stat } from '../components/ui'
import { useApi } from '../lib/api'
import { num } from '../lib/format'
import { eventsHref, Link } from '../lib/router'
import { useHours } from '../lib/settings'
import { EventList } from './EventsPage'

export function AppPage({ app }: { app: string }) {
  const hours = useHours()
  const detail = useApi<AppDetail>(`/api/apps/${encodeURIComponent(app)}?hours=${hours}`, {
    poll: 30_000,
  })
  return (
    <div class="page">
      <Crumbs items={[{ label: 'Overview', href: '/' }, { label: app }]} />
      <Loaded resource={detail}>
        {(d) =>
          d.kind === 'lines' ? <SourceView d={d} /> : <AppView d={d} reload={detail.reload} />
        }
      </Loaded>
    </div>
  )
}

function AppView({ d, reload }: { d: AppDetail; reload: () => void }) {
  const series = alertSeries(d.errorSeries, d.warnSeries)
  const open = d.issues.filter((i) => i.state === 'open')
  return (
    <>
      <div class="page-head">
        <h1>{d.app}</h1>
        <div class="page-actions">
          <span class="muted small">
            Last event <Ago ts={d.lastEventAt} />
          </span>
          <Link class="btn" href={eventsHref({ app: d.app })}>
            Browse events
          </Link>
        </div>
      </div>

      <div class="stats">
        <Stat
          label="Errors"
          tone="critical"
          value={num(d.totals.errors)}
          hint={d.totals.muted ? `${num(d.totals.muted)} muted events not counted` : undefined}
        />
        <Stat label="Warnings" tone="warning" value={num(d.totals.warns)} />
        <Stat label="Open issues" value={num(open.length)} hint={newHint(open)} />
        <Stat label="All events" value={num(d.totals.events)} />
      </div>

      <Card title="Errors and warnings" actions={<Legend series={series} />}>
        <StackedColumns window={d.window} series={series} empty="No errors or warnings" />
      </Card>

      <div class="split">
        <IssuesCard issues={d.issues} window={d.window} onChanged={reload} />
        <div class="stack-col">
          <Card title="Failing routes" flush>
            {d.routes.length ? (
              <table class="table compact">
                <tbody>
                  {d.routes.map((r) => (
                    <tr key={`${r.method} ${r.route}`}>
                      <td class="truncate">
                        <Route method={r.method} route={r.route} />
                      </td>
                      <td class="num">
                        {r.errors > 0 && <span class="count critical">{num(r.errors)}</span>}
                        {r.errors > 0 && r.warns > 0 && ' '}
                        {r.warns > 0 && <span class="count warning">{num(r.warns)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No request errors</Empty>
            )}
          </Card>
          <Card title="Status codes">
            <BarList
              items={d.statuses}
              label={(s) => <span class={`status s${s[0]}`}>{s}</span>}
              empty="No HTTP statuses recorded"
            />
          </Card>
          <Card title="Releases with problems">
            <BarList
              items={d.releases}
              label={(r) => <code>{r}</code>}
              empty="No releases recorded"
            />
          </Card>
        </div>
      </div>
    </>
  )
}

function newHint(issues: IssueSummary[]) {
  const n = issues.filter((i) => i.isNew).length
  const regressed = issues.filter((i) => i.regressed).length
  const parts = [n && `${n} new`, regressed && `${regressed} regressed`].filter(Boolean)
  return parts.length ? `${parts.join(', ')} in this window` : undefined
}

/** An agent-shipped source has no levels, so show volume and the latest lines. */
function SourceView({ d }: { d: AppDetail }) {
  const series = [{ key: 'v', label: 'Lines', color: VOLUME_COLOR, values: d.volumeSeries }]
  return (
    <>
      <div class="page-head">
        <h1>{d.app}</h1>
        <div class="page-actions">
          <span class="muted small">
            Raw log source · last line <Ago ts={d.lastEventAt} />
          </span>
          <Link class="btn" href={eventsHref({ app: d.app })}>
            Search lines
          </Link>
        </div>
      </div>
      <Card title={`Lines received (${num(d.totals.events)})`}>
        <StackedColumns window={d.window} series={series} empty="No lines in this window" />
      </Card>
      <Card title="Latest lines" flush>
        <EventList filter={{ app: d.app }} compact />
      </Card>
    </>
  )
}
