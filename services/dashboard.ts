import { db } from '@database/db'
import type { EventRow } from '@database/schema'
import type { AlertLevel } from '@/shared/api-types'
import { sql } from 'kysely'
import { type EventJson, toEvent } from './event-store'
import { ALERT_LEVELS, issueSummaries } from './issues'
import { type Scope, inScope } from './scope'

export type { Issue } from './issues'

export const MAX_HOURS = 72

export interface DashboardOptions extends Scope {
  hours?: number | string
  /** Levels for recentErrors and issues: comma-separated or an array (default both) */
  levels?: string | string[]
  limit?: number | string
  /** Limit to one app; all apps by default */
  app?: string
  /** Max issues, most recently seen first (default 50) */
  issueLimit?: number | string
  /** Include stack traces in recentErrors (default true) */
  stacks?: boolean
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

function recentError(row: EventRow, stacks: boolean) {
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
    ...(stacks ? { stack: row.stack } : { hasStack: row.stack !== null }),
  }
}

export async function getDashboard(options: DashboardOptions = {}) {
  const hours = int(options.hours, 24, MAX_HOURS)
  const limit = int(options.limit, 25, 200)
  const issueLimit = int(options.issueLimit, 50, 250)
  const levels = alertLevels(options.levels)
  const { app, env, service } = options

  const now = new Date()
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()
  let inWindow = db.selectFrom('events').where('level', 'in', ALERT_LEVELS).where('ts', '>=', since)
  if (app) inWindow = inWindow.where('app', '=', app)
  inWindow = inScope(inWindow, { env, service })
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
    issueSummaries({ app, env, service, levels, since, limit: issueLimit }),
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
    since,
    totals,
    byApp: [...apps.values()].sort((a, b) => b.errors - a.errors || b.warns - a.warns),
    byHour: [...byHour.values()],
    topCodes,
    issues,
    recentErrors: recent.map((row) => recentError(row, options.stacks ?? true)),
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
