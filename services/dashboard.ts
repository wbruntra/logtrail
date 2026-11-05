import { db } from '@database/db'
import type { EventRow } from '@database/schema'
import { sql } from 'kysely'
import { type EventJson, toEvent } from './event-store'
import { normalizePath } from './fingerprint'

export const MAX_HOURS = 72
const ALERT_LEVELS = ['error', 'warn'] as const
type AlertLevel = (typeof ALERT_LEVELS)[number]

export interface DashboardOptions {
  hours?: number | string
  /** Levels for recentErrors and issues: comma-separated or an array (default both) */
  levels?: string | string[]
  limit?: number | string
}

export interface Issue {
  fingerprint: string
  app: string
  level: AlertLevel
  msg: string
  code: string | null
  method: string | null
  /** Route pattern, or the request path with ids replaced */
  route: string | null
  status: number | null
  count: number
  users: number
  /** Earliest occurrence still retained, regardless of the dashboard window */
  firstSeen: string
  lastSeen: string
  releases: string[]
  latestId: number
}

function int(value: number | string | undefined, fallback: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(value ?? '', 10)
  return Math.min(Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback, max)
}

function alertLevels(value: string | string[] | undefined): AlertLevel[] {
  const list = Array.isArray(value) ? value : (value ?? '').split(',')
  const levels = ALERT_LEVELS.filter((l) => list.map((s) => s.trim()).includes(l))
  return levels.length ? levels : [...ALERT_LEVELS]
}

const hourOf = (ts: string) => `${ts.slice(0, 13)}:00:00.000Z`

function recentError(row: EventRow) {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    ts: row.ts,
    app: row.app,
    level: row.level,
    code: row.code,
    msg: row.msg,
    method: row.method,
    path: row.path,
    status: row.status,
    duration: row.duration_ms,
    reqId: row.req_id,
    userId: row.user_id,
    stack: row.stack,
  }
}

interface IssueFilter {
  fingerprints?: string[]
  levels?: AlertLevel[]
  since?: string
  limit: number
}

/** Errors and warnings grouped by fingerprint, most recently seen first. */
async function issueSummaries({
  fingerprints,
  levels,
  since,
  limit,
}: IssueFilter): Promise<Issue[]> {
  let groups = db
    .selectFrom('events')
    .where('fingerprint', 'is not', null)
    .select((eb) => [
      'fingerprint',
      eb.fn.countAll<number>().as('count'),
      eb.fn.count<number>('user_id').distinct().as('users'),
      eb.fn.max('ts').as('lastSeen'),
      eb.fn.max('id').as('latestId'),
      sql<string | null>`group_concat(distinct release)`.as('releases'),
    ])
    .groupBy('fingerprint')
    .orderBy('lastSeen', 'desc')
    .limit(limit)
    .$narrowType<{ fingerprint: string }>()
  if (fingerprints) groups = groups.where('fingerprint', 'in', fingerprints)
  if (levels) groups = groups.where('level', 'in', levels)
  if (since) groups = groups.where('ts', '>=', since)

  const rows = await groups.execute()
  if (!rows.length) return []

  const [latest, firstSeen] = await Promise.all([
    db
      .selectFrom('events')
      .selectAll()
      .where(
        'id',
        'in',
        rows.map((r) => r.latestId),
      )
      .execute(),
    db
      .selectFrom('events')
      .select((eb) => ['fingerprint', eb.fn.min('ts').as('firstSeen')])
      .where(
        'fingerprint',
        'in',
        rows.map((r) => r.fingerprint),
      )
      .groupBy('fingerprint')
      .execute(),
  ])
  const latestById = new Map(latest.map((e) => [e.id, e]))
  const firstSeenByFp = new Map(firstSeen.map((f) => [f.fingerprint, f.firstSeen]))

  return rows.map((r) => {
    const e = latestById.get(r.latestId)!
    return {
      fingerprint: r.fingerprint,
      app: e.app,
      level: e.level as AlertLevel,
      msg: e.msg,
      code: e.code,
      method: e.method,
      route: e.route ?? (e.path ? normalizePath(e.path) : null),
      status: e.status,
      count: r.count,
      users: r.users,
      firstSeen: firstSeenByFp.get(r.fingerprint) ?? r.lastSeen,
      lastSeen: r.lastSeen,
      releases: r.releases ? r.releases.split(',').sort() : [],
      latestId: r.latestId,
    }
  })
}

export async function getDashboard(options: DashboardOptions = {}) {
  const hours = int(options.hours, 24, MAX_HOURS)
  const limit = int(options.limit, 25, 200)
  const levels = alertLevels(options.levels)

  const now = new Date()
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()
  const inWindow = db
    .selectFrom('events')
    .where('level', 'in', ALERT_LEVELS)
    .where('ts', '>=', since)
  const count = sql<number>`count(*)`.as('count')

  const [byAppLevel, byHourLevel, topCodes, recent, issues] = await Promise.all([
    inWindow.select(['app', 'level', count]).groupBy(['app', 'level']).execute(),
    inWindow
      .select([sql<string>`substr(ts, 1, 13)`.as('hour'), 'level', count])
      .groupBy([sql`substr(ts, 1, 13)`, 'level'])
      .execute(),
    inWindow
      .select(['code', count])
      .where('code', 'is not', null)
      .groupBy('code')
      .orderBy('count', 'desc')
      .limit(8)
      .$narrowType<{ code: string }>()
      .execute(),
    inWindow
      .selectAll()
      .where('level', 'in', levels)
      .orderBy('ts', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute(),
    issueSummaries({ levels, since, limit: 50 }),
  ])

  const totals = { errors: 0, warns: 0 }
  const apps = new Map<string, { app: string; errors: number; warns: number }>()
  for (const { app, level, count } of byAppLevel) {
    const key = level === 'error' ? 'errors' : 'warns'
    totals[key] += count
    if (!apps.has(app)) apps.set(app, { app, errors: 0, warns: 0 })
    apps.get(app)![key] += count
  }

  // Pre-build the hourly buckets so hours with zero events still appear
  const byHour = new Map<string, { hour: string; errors: number; warns: number }>()
  for (let i = hours - 1; i >= 0; i--) {
    const hour = hourOf(new Date(now.getTime() - i * 60 * 60 * 1000).toISOString())
    byHour.set(hour, { hour, errors: 0, warns: 0 })
  }
  for (const { hour, level, count } of byHourLevel) {
    const bucket = byHour.get(hourOf(hour))
    if (bucket) bucket[level === 'error' ? 'errors' : 'warns'] += count
  }

  return {
    period: hours,
    totals,
    byApp: [...apps.values()].sort((a, b) => b.errors - a.errors || b.warns - a.warns),
    byHour: [...byHour.values()],
    topCodes,
    issues,
    recentErrors: recent.map(recentError),
  }
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>

/** One issue with its most recent occurrences, or null if nothing is retained for it. */
export async function getIssue(fingerprint: string, { limit = 20 }: { limit?: number } = {}) {
  const [issue] = await issueSummaries({ fingerprints: [fingerprint], limit: 1 })
  if (!issue) return null

  const events = await db
    .selectFrom('events')
    .selectAll()
    .where('fingerprint', '=', fingerprint)
    .orderBy('id', 'desc')
    .limit(Math.min(limit, 200))
    .execute()

  return {
    ...issue,
    events: events.map((e): EventJson & { id: number; app: string } => ({
      id: e.id,
      app: e.app,
      ...toEvent(e),
    })),
  }
}

export type IssueDetail = NonNullable<Awaited<ReturnType<typeof getIssue>>>
