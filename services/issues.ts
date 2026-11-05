import { db } from '@database/db'
import type { IssueStatesTable } from '@database/schema'
import type {
  AlertLevel,
  Breakdown,
  IssueDetail,
  IssueState,
  IssueSummary,
  Window,
} from '@/shared/api-types'
import { type ExpressionBuilder, sql } from 'kysely'
import { listEvents } from './event-query'
import { normalizePath } from './fingerprint'
import { bucketOf, makeWindow, toSeries } from './window'

export const ALERT_LEVELS = ['error', 'warn'] as const

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

export interface IssueFilter {
  fingerprints?: string[]
  app?: string
  levels?: readonly AlertLevel[]
  /** Count only occurrences at or after this ISO time */
  since?: string
  limit: number
}

/** Errors and warnings grouped by fingerprint, most recently seen first. */
export async function issueSummaries({
  fingerprints,
  app,
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
  if (app) groups = groups.where('app', '=', app)
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

/** Occurrences per window bucket for each fingerprint. */
async function issueSeries(window: Window, fingerprints: string[]) {
  const bySeries = new Map<string, { bucket: number; count: number }[]>()
  if (!fingerprints.length) return bySeries
  const bucket = bucketOf(window)
  const rows = await db
    .selectFrom('events')
    .select((eb) => ['fingerprint', bucket.as('bucket'), eb.fn.countAll<number>().as('count')])
    .where('fingerprint', 'in', fingerprints)
    .where('ts', '>=', window.since)
    .groupBy(['fingerprint', bucket])
    .$narrowType<{ fingerprint: string }>()
    .execute()
  for (const { fingerprint, ...point } of rows) {
    if (!bySeries.has(fingerprint)) bySeries.set(fingerprint, [])
    bySeries.get(fingerprint)!.push(point)
  }
  return bySeries
}

type StateRow = Pick<IssueStatesTable, 'status' | 'changed_at'>

/** Stored states of the given issues; open issues have none. */
async function statesOf(fingerprints: string[]): Promise<Map<string, StateRow>> {
  if (!fingerprints.length) return new Map()
  const rows = await db
    .selectFrom('issue_states')
    .selectAll()
    .where('fingerprint', 'in', fingerprints)
    .execute()
  return new Map(rows.map((r) => [r.fingerprint, r]))
}

/** A resolved issue seen since it was resolved is open again: a regression. */
function stateOf(row: StateRow | undefined, lastSeen: string) {
  if (!row) return { state: 'open' as const, regressed: false, stateChangedAt: null }
  if (row.status === 'resolved' && lastSeen > row.changed_at) {
    return { state: 'open' as const, regressed: true, stateChangedAt: row.changed_at }
  }
  return { state: row.status, regressed: false, stateChangedAt: row.changed_at }
}

/** Where-clause: the event doesn't belong to a muted issue. */
export function notMuted(eb: ExpressionBuilder<any, any>) {
  return eb.or([
    eb('fingerprint', 'is', null),
    eb(
      'fingerprint',
      'not in',
      eb.selectFrom('issue_states').select('fingerprint').where('status', '=', 'muted'),
    ),
  ])
}

/** Fingerprints of resolved issues, with when they were resolved. */
export async function resolvedSince(): Promise<Map<string, string>> {
  const rows = await db
    .selectFrom('issue_states')
    .select(['fingerprint', 'changed_at'])
    .where('status', '=', 'resolved')
    .execute()
  return new Map(rows.map((r) => [r.fingerprint, r.changed_at]))
}

/** Issues seen in the window, with per-bucket counts for sparklines. */
export async function windowIssues(
  window: Window,
  filter: { app?: string; limit?: number } = {},
): Promise<IssueSummary[]> {
  const issues = await issueSummaries({
    app: filter.app,
    since: window.since,
    limit: filter.limit ?? 250,
  })
  const fingerprints = issues.map((i) => i.fingerprint)
  const [series, states] = await Promise.all([
    issueSeries(window, fingerprints),
    statesOf(fingerprints),
  ])
  return issues.map((i) => ({
    ...i,
    isNew: i.firstSeen >= window.since,
    ...stateOf(states.get(i.fingerprint), i.lastSeen),
    series: toSeries(window, series.get(i.fingerprint) ?? []),
  }))
}

/**
 * Resolve, mute or reopen issues. Reopening deletes the state; setting the
 * status an issue already has refreshes its time, so a regressed issue can be
 * resolved again.
 */
export async function setIssueState(fingerprints: string[], status: IssueState) {
  if (!fingerprints.length) return
  if (status === 'open') {
    await db.deleteFrom('issue_states').where('fingerprint', 'in', fingerprints).execute()
    return
  }
  const changed_at = new Date().toISOString()
  await db
    .insertInto('issue_states')
    .values(fingerprints.map((fingerprint) => ({ fingerprint, status, changed_at })))
    .onConflict((oc) => oc.column('fingerprint').doUpdateSet({ status, changed_at }))
    .execute()
}

type BreakdownColumn = 'release' | 'path' | 'status' | 'user_id'

async function breakdown(
  fingerprint: string,
  since: string,
  column: BreakdownColumn,
): Promise<Breakdown[]> {
  const rows = await db
    .selectFrom('events')
    .select((eb) => [eb.ref(column).as('value'), eb.fn.countAll<number>().as('count')])
    .where('fingerprint', '=', fingerprint)
    .where('ts', '>=', since)
    .where(column, 'is not', null)
    .groupBy(column)
    .orderBy('count', 'desc')
    .orderBy(column)
    .limit(10)
    .execute()
  return rows.map((r) => ({ value: String(r.value), count: r.count }))
}

/** An issue with its history over the window, or null if nothing is retained for it. */
export async function getIssueDetail(
  fingerprint: string,
  hours?: number | string,
  occurrenceLimit = 25,
): Promise<IssueDetail | null> {
  const window = makeWindow(hours)
  const [all] = await issueSummaries({ fingerprints: [fingerprint], limit: 1 })
  if (!all) return null

  const [[inWindow], series, latestStack, releases, paths, statuses, users, occurrences, states] =
    await Promise.all([
      issueSummaries({ fingerprints: [fingerprint], since: window.since, limit: 1 }),
      issueSeries(window, [fingerprint]),
      db
        .selectFrom('events')
        .select('stack')
        .where('fingerprint', '=', fingerprint)
        .where('stack', 'is not', null)
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst(),
      breakdown(fingerprint, window.since, 'release'),
      breakdown(fingerprint, window.since, 'path'),
      breakdown(fingerprint, window.since, 'status'),
      breakdown(fingerprint, window.since, 'user_id'),
      listEvents({ fingerprint, limit: occurrenceLimit }),
      statesOf([fingerprint]),
    ])

  return {
    ...all,
    count: inWindow?.count ?? 0,
    users: inWindow?.users ?? 0,
    totalCount: all.count,
    isNew: all.firstSeen >= window.since,
    ...stateOf(states.get(fingerprint), all.lastSeen),
    series: toSeries(window, series.get(fingerprint) ?? []),
    window,
    stack: latestStack?.stack ?? null,
    breakdowns: { releases, paths, statuses, users },
    occurrences,
  }
}
