import type { AppSummary, Overview as OverviewData, Window } from '@shared/api-types.ts'
import { alertSeries, Legend, Spark, StackedColumns, VOLUME_COLOR } from '../components/charts'
import { Ago, Card, Empty, Loaded, Stat } from '../components/ui'
import { useApi } from '../lib/api'
import { num, plural } from '../lib/format'
import { appHref, Link, rowLink } from '../lib/router'
import { useEnv, useHours, WINDOWS } from '../lib/settings'

const sumSeries = (apps: AppSummary[], key: 'errorSeries' | 'warnSeries', n: number) =>
  apps.reduce((acc, a) => acc.map((v, i) => v + a[key][i]), new Array<number>(n).fill(0))

export function Overview() {
  const hours = useHours()
  const env = useEnv()
  const overview = useApi<OverviewData>(`/api/apps?hours=${hours}&env=${encodeURIComponent(env)}`, {
    poll: 30_000,
  })
  return <Loaded resource={overview}>{(data) => <OverviewView data={data} />}</Loaded>
}

function OverviewView({ data }: { data: OverviewData }) {
  const { window, totals, apps } = data
  const structured = apps.filter((a) => a.kind === 'structured')
  const sources = apps.filter((a) => a.kind === 'lines')
  const n = window.buckets.length
  const series = alertSeries(
    sumSeries(structured, 'errorSeries', n),
    sumSeries(structured, 'warnSeries', n),
  )
  const label = WINDOWS.find((w) => w.hours === window.hours)?.label ?? `${window.hours}h`

  return (
    <div class="page">
      <div class="page-head">
        <h1>Overview</h1>
        <p class="muted">All apps, last {label}</p>
      </div>

      <div class="stats">
        <Stat
          label="Errors"
          tone="critical"
          value={num(totals.errors)}
          hint={totals.muted ? `${num(totals.muted)} muted events not counted` : undefined}
        />
        <Stat label="Warnings" tone="warning" value={num(totals.warns)} />
        <Stat label="Open issues" value={num(totals.issues)} />
        <Stat label="New issues" value={num(totals.newIssues)} hint="first seen in this window" />
      </div>

      <Card title="Errors and warnings" actions={<Legend series={series} />}>
        <StackedColumns window={window} series={series} empty="No errors or warnings" />
      </Card>

      <Card title="Apps" flush>
        {structured.length ? (
          <AppTable apps={structured} window={window} />
        ) : (
          <Empty>No app has sent structured events yet.</Empty>
        )}
      </Card>

      {sources.length > 0 && (
        <Card title="Raw log sources" flush>
          <SourceTable apps={sources} window={window} />
        </Card>
      )}
    </div>
  )
}

function AppTable({ apps, window }: { apps: AppSummary[]; window: Window }) {
  return (
    <table class="table rows-link">
      <thead>
        <tr>
          <th>App</th>
          <th class="hide-sm">Trend</th>
          <th class="num">Errors</th>
          <th class="num">Warnings</th>
          <th class="num">Issues</th>
          <th class="hide-sm">Last error</th>
        </tr>
      </thead>
      <tbody>
        {apps.map((a) => {
          const quiet = a.errors === 0 && a.warns === 0
          return (
            <tr key={a.app} class={quiet ? 'quiet' : ''} onClick={rowLink(appHref(a.app))}>
              <td>
                <Link class="row-title" href={appHref(a.app)}>
                  {a.app}
                </Link>
                <div class="row-sub muted">
                  {plural(a.events, 'event')} · last <Ago ts={a.lastEventAt} />
                </div>
              </td>
              <td class="hide-sm">
                <Spark window={window} series={alertSeries(a.errorSeries, a.warnSeries)} />
              </td>
              <td class="num">
                <Count n={a.errors} tone="critical" />
              </td>
              <td class="num">
                <Count n={a.warns} tone="warning" />
              </td>
              <td class="num">
                {num(a.issues)}
                {a.newIssues > 0 && <span class="badge new">{a.newIssues} new</span>}
              </td>
              <td class="hide-sm">
                <Ago ts={a.lastErrorAt} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function SourceTable({ apps, window }: { apps: AppSummary[]; window: Window }) {
  return (
    <table class="table rows-link">
      <thead>
        <tr>
          <th>Source</th>
          <th class="hide-sm">Volume</th>
          <th class="num">Lines</th>
          <th>Last line</th>
        </tr>
      </thead>
      <tbody>
        {apps.map((a) => (
          <tr key={a.app} class={a.events ? '' : 'quiet'} onClick={rowLink(appHref(a.app))}>
            <td>
              <Link class="row-title" href={appHref(a.app)}>
                {a.app}
              </Link>
            </td>
            <td class="hide-sm">
              <Spark
                window={window}
                series={[{ key: 'v', label: 'Lines', color: VOLUME_COLOR, values: a.volumeSeries }]}
              />
            </td>
            <td class="num">{num(a.events)}</td>
            <td>
              <Ago ts={a.lastEventAt} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Count({ n, tone }: { n: number; tone: 'critical' | 'warning' }) {
  if (!n) return <span class="muted">0</span>
  return <span class={`count ${tone}`}>{num(n)}</span>
}
