import { db } from '@database/db'
import type {
  AppDetail,
  AppSummary,
  Breakdown,
  Overview,
  RouteHealth,
  Series,
  Window,
} from '@/shared/api-types'
import { sql } from 'kysely'
import { normalizePath } from './fingerprint'
import { ALERT_LEVELS, notMuted, windowIssues } from './issues'
import { bucketOf, makeWindow, toSeries } from './window'

interface LevelBucket {
  app: string
  level: string | null
  /** 1 when the events belong to a muted issue */
  muted: number
  bucket: number
  count: number
}

const IS_MUTED = sql<number>`coalesce(fingerprint in
  (select fingerprint from issue_states where status = 'muted'), 0)`

/** Event counts per app, level, muted-ness and bucket over the window. */
function levelBuckets(window: Window, app?: string): Promise<LevelBucket[]> {
  const bucket = bucketOf(window)
  let query = db
    .selectFrom('events')
    .select((eb) => [
      'app',
      'level',
      IS_MUTED.as('muted'),
      bucket.as('bucket'),
      eb.fn.countAll<number>().as('count'),
    ])
    .where('ts', '>=', window.since)
    .groupBy(['app', 'level', IS_MUTED, bucket])
  if (app) query = query.where('app', '=', app)
  return query.execute()
}

interface Series3 {
  errorSeries: Series
  warnSeries: Series
  volumeSeries: Series
}

/** Error and warning series leave out muted issues; volume counts all traffic. */
function seriesOf(window: Window, rows: LevelBucket[]): Series3 {
  const counted = rows.filter((r) => !r.muted)
  return {
    errorSeries: toSeries(
      window,
      counted.filter((r) => r.level === 'error'),
    ),
    warnSeries: toSeries(
      window,
      counted.filter((r) => r.level === 'warn'),
    ),
    volumeSeries: toSeries(window, rows),
  }
}

const sum = (s: Series) => s.reduce((a, b) => a + b, 0)
const mutedCount = (rows: LevelBucket[]) => rows.reduce((n, r) => n + (r.muted ? r.count : 0), 0)

/** Per app: newest event, newest error, and whether it ever sent structured events. */
async function appFacts(app?: string) {
  let query = db
    .selectFrom('events')
    .select((eb) => [
      'app',
      eb.fn.max('ts').as('lastEventAt'),
      eb.fn.count<number>('level').as('structured'),
    ])
    .groupBy('app')
  let errors = db
    .selectFrom('events')
    .select((eb) => ['app', eb.fn.max('ts').as('lastErrorAt')])
    .where('level', '=', 'error')
    .where(notMuted)
    .groupBy('app')
  if (app) {
    query = query.where('app', '=', app)
    errors = errors.where('app', '=', app)
  }
  const [facts, lastErrors] = await Promise.all([query.execute(), errors.execute()])
  const lastErrorAt = new Map(lastErrors.map((r) => [r.app, r.lastErrorAt]))
  return new Map(
    facts.map((f) => [
      f.app,
      {
        lastEventAt: f.lastEventAt,
        lastErrorAt: lastErrorAt.get(f.app) ?? null,
        kind: f.structured > 0 ? ('structured' as const) : ('lines' as const),
      },
    ]),
  )
}

/**
 * Open issues active in the window per app, and how many of them first
 * appeared in it. Muted issues, and resolved ones not seen since, don't count.
 */
async function issueCounts(window: Window) {
  const [rows, states] = await Promise.all([
    db
      .selectFrom('events')
      .select((eb) => [
        'app',
        'fingerprint',
        eb.fn.min('ts').as('firstSeen'),
        eb.fn.max('ts').as('lastSeen'),
      ])
      .where('fingerprint', 'is not', null)
      .groupBy(['app', 'fingerprint'])
      .having((eb) => eb.fn.max('ts'), '>=', window.since)
      .$narrowType<{ fingerprint: string }>()
      .execute(),
    db.selectFrom('issue_states').selectAll().execute(),
  ])
  const stateOf = new Map(states.map((s) => [s.fingerprint, s]))
  const counts = new Map<string, { issues: number; newIssues: number }>()
  for (const r of rows) {
    const state = stateOf.get(r.fingerprint)
    if (state?.status === 'muted') continue
    if (state?.status === 'resolved' && r.lastSeen <= state.changed_at) continue
    if (!counts.has(r.app)) counts.set(r.app, { issues: 0, newIssues: 0 })
    const c = counts.get(r.app)!
    c.issues++
    if (r.firstSeen >= window.since) c.newIssues++
  }
  return counts
}

export async function getOverview(hours?: number | string, now = new Date()): Promise<Overview> {
  const window = makeWindow(hours, now)
  const [buckets, facts, issues] = await Promise.all([
    levelBuckets(window),
    appFacts(),
    issueCounts(window),
  ])

  const byApp = new Map<string, LevelBucket[]>()
  for (const row of buckets) {
    if (!byApp.has(row.app)) byApp.set(row.app, [])
    byApp.get(row.app)!.push(row)
  }

  const apps: AppSummary[] = [...facts].map(([app, f]) => {
    const s = seriesOf(window, byApp.get(app) ?? [])
    return {
      app,
      kind: f.kind,
      events: sum(s.volumeSeries),
      errors: sum(s.errorSeries),
      warns: sum(s.warnSeries),
      ...(issues.get(app) ?? { issues: 0, newIssues: 0 }),
      lastEventAt: f.lastEventAt,
      lastErrorAt: f.lastErrorAt,
      ...s,
    }
  })
  apps.sort(
    (a, b) =>
      b.errors - a.errors ||
      b.warns - a.warns ||
      (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? ''),
  )

  const totals = { events: 0, errors: 0, warns: 0, issues: 0, newIssues: 0 }
  for (const a of apps) {
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += a[k]
  }
  return { window, totals: { ...totals, muted: mutedCount(buckets) }, apps }
}

/** Errors and warnings per route; ids in raw paths are folded so /users/1 and /users/2 merge. */
async function routeHealth(window: Window, app: string): Promise<RouteHealth[]> {
  const rows = await db
    .selectFrom('events')
    .select((eb) => ['method', 'route', 'path', 'level', eb.fn.countAll<number>().as('count')])
    .where('app', '=', app)
    .where('ts', '>=', window.since)
    .where('level', 'in', ALERT_LEVELS)
    .where(notMuted)
    .where((eb) => eb.or([eb('route', 'is not', null), eb('path', 'is not', null)]))
    .groupBy(['method', 'route', 'path', 'level'])
    .execute()

  const merged = new Map<string, RouteHealth>()
  for (const r of rows) {
    const route = r.route ?? normalizePath(r.path!)
    const key = `${r.method ?? ''} ${route}`
    if (!merged.has(key)) merged.set(key, { method: r.method, route, errors: 0, warns: 0 })
    merged.get(key)![r.level === 'error' ? 'errors' : 'warns'] += r.count
  }
  return [...merged.values()].sort((a, b) => b.errors - a.errors || b.warns - a.warns).slice(0, 15)
}

async function columnCounts(
  window: Window,
  app: string,
  column: 'status' | 'release',
): Promise<Breakdown[]> {
  let query = db
    .selectFrom('events')
    .select((eb) => [eb.ref(column).as('value'), eb.fn.countAll<number>().as('count')])
    .where('app', '=', app)
    .where('ts', '>=', window.since)
    .where(column, 'is not', null)
    .where(notMuted)
    .groupBy(column)
    .orderBy('count', 'desc')
    .orderBy(column)
    .limit(12)
  // Releases matter for where problems come from; statuses for all traffic
  if (column === 'release') query = query.where('level', 'in', ALERT_LEVELS)
  const rows = await query.execute()
  return rows.map((r) => ({ value: String(r.value), count: r.count }))
}

/** One app's health over the window, or null if nothing is retained for it. */
export async function getAppDetail(
  app: string,
  hours?: number | string,
  now = new Date(),
): Promise<AppDetail | null> {
  const window = makeWindow(hours, now)
  const facts = (await appFacts(app)).get(app)
  if (!facts) return null

  const [buckets, issues, routes, statuses, releases] = await Promise.all([
    levelBuckets(window, app),
    windowIssues(window, { app }),
    routeHealth(window, app),
    columnCounts(window, app, 'status'),
    columnCounts(window, app, 'release'),
  ])
  const s = seriesOf(window, buckets)
  return {
    app,
    kind: facts.kind,
    window,
    totals: {
      events: sum(s.volumeSeries),
      errors: sum(s.errorSeries),
      warns: sum(s.warnSeries),
      muted: mutedCount(buckets),
    },
    ...s,
    issues,
    routes,
    statuses,
    releases,
    lastEventAt: facts.lastEventAt,
  }
}
