import { db } from '@database/db'
import type { Database, EventRow, Level } from '@database/schema'
import type { EventView } from '@/shared/api-types'
import { type SelectQueryBuilder, sql } from 'kysely'
import { type Scope, inScope } from './scope'
import {
  getNeighbors,
  type LevelFilter,
  listApps,
  type LogLine,
  SEARCH_TEXT,
  toEventView,
  toLine,
} from './event-query'

// Searches ingested events. Plain queries match in SQL against the event's text
// fields; regex queries are narrowed by the other filters in SQL, then matched in
// JS against the rendered line (bun:sqlite cannot register a REGEXP function).

const REGEX_BATCH = 5000

export interface SearchOptions extends Scope {
  /** Limit to one app; all apps by default */
  app?: string
  query?: string
  regex?: boolean
  caseSensitive?: boolean
  /** Structured events with this request id, or agent lines containing it */
  reqId?: string
  /** ISO timestamps, inclusive */
  since?: string
  until?: string
  /** Levels, with 'none' for the agent's unstructured lines */
  levels?: LevelFilter[]
  /** An exact HTTP status, or a class such as '5xx' */
  status?: number | string
  code?: string
  userId?: string
  /** Route pattern, exact, e.g. /users/:id */
  route?: string
  /** Request path prefix, e.g. /api/sheets */
  pathPrefix?: string
  /** Fields without a column of their own (the event's `extra`), all of which must equal these */
  extra?: Record<string, string | number | boolean>
  /** Lines of the same app to include before and after each match */
  context?: number
  limit?: number
}

export interface SearchMatch extends LogLine {
  app: string
  ts: string
  context?: LogLine[]
}

export interface EventMatch extends EventView {
  context?: EventView[]
}

type Found<T> = { appsSearched: string[]; totalMatches: number; truncated: boolean; results: T[] }

export type SearchResult = Found<SearchMatch> | { error: string }
export type EventSearchResult = Found<EventMatch> | { error: string }

const STATUS_CLASS = /^([1-5])xx$/i

function isoBound(value: string | undefined): string | null | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

type Filtered = {
  filtered: SelectQueryBuilder<Database, 'events', {}>
  re: RegExp | undefined
}

const EXTRA_KEY = /^[A-Za-z_][\w]*$/

/** The events table narrowed by every filter except limit, and the regex still to apply in JS. */
function buildFilter({
  app,
  env,
  service,
  query,
  regex = false,
  caseSensitive = false,
  reqId,
  since,
  until,
  levels,
  status,
  code,
  userId,
  route,
  pathPrefix,
  extra,
}: SearchOptions): Filtered | { error: string } {
  let re: RegExp | undefined
  if (query && regex) {
    try {
      re = new RegExp(query, caseSensitive ? '' : 'i')
    } catch {
      return { error: 'Invalid regex' }
    }
  }
  const sinceIso = isoBound(since)
  const untilIso = isoBound(until)
  if (sinceIso === null || untilIso === null) {
    return { error: 'since/until must be ISO timestamps' }
  }

  const statusClass = typeof status === 'string' ? STATUS_CLASS.exec(status) : null
  const statusCode = typeof status === 'string' && !statusClass ? Number(status) : status
  if (typeof statusCode === 'number' && !Number.isInteger(statusCode)) {
    return { error: "status must be a number or a class such as '5xx'" }
  }

  let filtered = db.selectFrom('events')
  if (app) filtered = filtered.where('app', '=', app)
  filtered = inScope(filtered, { env, service })
  if (sinceIso) filtered = filtered.where('ts', '>=', sinceIso)
  if (untilIso) filtered = filtered.where('ts', '<=', untilIso)
  if (reqId) {
    filtered = filtered.where((eb) =>
      eb.or([
        eb('req_id', '=', reqId),
        eb.and([eb('level', 'is', null), eb(sql`instr(msg, ${reqId})`, '>', 0)]),
      ]),
    )
  }
  if (levels?.length) {
    const named = levels.filter((l): l is Level => l !== 'none')
    filtered = filtered.where((eb) =>
      eb.or([
        ...(named.length ? [eb('level', 'in', named)] : []),
        ...(levels.includes('none') ? [eb('level', 'is', null)] : []),
      ]),
    )
  }
  if (statusClass) {
    const floor = Number(statusClass[1]) * 100
    filtered = filtered.where('status', '>=', floor).where('status', '<', floor + 100)
  } else if (typeof statusCode === 'number') {
    filtered = filtered.where('status', '=', statusCode)
  }
  if (code) filtered = filtered.where('code', '=', code)
  if (userId) filtered = filtered.where('user_id', '=', userId)
  if (route) filtered = filtered.where('route', '=', route)
  if (pathPrefix) {
    filtered = filtered.where(sql<boolean>`substr(path, 1, ${pathPrefix.length}) = ${pathPrefix}`)
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (!EXTRA_KEY.test(key)) return { error: `Invalid extra field name: ${key}` }
    // Compared as text, so tokenId 2239 matches "2239" and true matches "1"
    const wanted = typeof value === 'boolean' ? (value ? '1' : '0') : String(value)
    filtered = filtered.where(
      sql<boolean>`cast(json_extract(extra, ${'$.' + key}) as text) = ${wanted}`,
    )
  }
  if (query && !re) {
    filtered = filtered.where(
      caseSensitive
        ? sql<boolean>`instr(${SEARCH_TEXT}, ${query}) > 0`
        : sql<boolean>`instr(lower(${SEARCH_TEXT}), lower(${query})) > 0`,
    )
  }

  return { filtered, re }
}

/** The newest `limit` matching rows in chronological order, with the count of all matches. */
async function findMatches(
  options: SearchOptions,
): Promise<{ rows: EventRow[]; totalMatches: number } | { error: string }> {
  const built = buildFilter(options)
  if ('error' in built) return built
  const { filtered, re } = built
  const { limit = 100 } = options

  let newest: EventRow[]
  let totalMatches: number
  if (re) {
    // Walk newest to oldest in id order, counting every match, keeping the newest `limit`
    newest = []
    totalMatches = 0
    let cursor: number | undefined
    for (;;) {
      let batch = filtered.selectAll().orderBy('id', 'desc').limit(REGEX_BATCH)
      if (cursor !== undefined) batch = batch.where('id', '<', cursor)
      const rows = await batch.execute()
      for (const row of rows) {
        if (!re.test(toLine(row).content)) continue
        totalMatches++
        if (newest.length < limit) newest.push(row)
      }
      if (rows.length < REGEX_BATCH) break
      cursor = rows[rows.length - 1].id
    }
  } else {
    const [rows, { n }] = await Promise.all([
      filtered.selectAll().orderBy('id', 'desc').limit(limit).execute(),
      filtered.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ])
    newest = rows
    totalMatches = n
  }

  const rows = newest.sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id)
  return { rows, totalMatches }
}

async function search<T>(
  options: SearchOptions,
  toMatch: (row: EventRow, context: EventRow[]) => T,
): Promise<Found<T> | { error: string }> {
  const found = await findMatches(options)
  if ('error' in found) return found
  const context = options.context ?? 0
  const results = await Promise.all(
    found.rows.map(async (row) => {
      if (context <= 0) return toMatch(row, [])
      const { before, after } = await getNeighbors(row.app, row.id, context)
      return toMatch(row, [...before, ...after])
    }),
  )
  return {
    appsSearched: options.app ? [options.app] : await listApps(),
    totalMatches: found.totalMatches,
    truncated: found.totalMatches > results.length,
    results,
  }
}

/** The newest `limit` matches in chronological order, rendered as log lines. */
export function searchLogs(options: SearchOptions): Promise<SearchResult> {
  return search(options, (row, context) => ({
    app: row.app,
    service: row.service,
    env: row.env,
    ts: row.ts,
    ...toLine(row),
    ...(options.context && { context: context.map(toLine) }),
  }))
}

/** The newest `limit` matches in chronological order, as parsed events. */
export function searchEvents(options: SearchOptions): Promise<EventSearchResult> {
  return search(options, (row, context) => ({
    ...toEventView(row),
    ...(options.context && { context: context.map(toEventView) }),
  }))
}

const GROUP_COLUMNS = {
  app: sql`app`,
  service: sql`service`,
  env: sql`env`,
  level: sql`level`,
  code: sql`code`,
  status: sql`status`,
  route: sql`route`,
  release: sql`release`,
  userId: sql`user_id`,
  hour: sql`substr(ts, 1, 13) || ':00'`,
  day: sql`substr(ts, 1, 10)`,
} as const

export const GROUP_BY_FIELDS = [...Object.keys(GROUP_COLUMNS), 'extra.<field>'] as const

export interface CountOptions extends SearchOptions {
  /** A column (app, service, env, level, code, status, route, release, userId), hour, day, or extra.<field> */
  groupBy: string
  /** Groups returned, largest first (default 20) */
  groups?: number
}

export type CountResult =
  | { error: string }
  | {
      groupBy: string
      since: string
      totalMatches: number
      groups: {
        value: string | number | null
        count: number
        firstSeen: string
        lastSeen: string
      }[]
      truncated: boolean
    }

/** Matching events counted per value of one field: failures per platform, errors per hour. */
export async function countEvents({
  groupBy,
  groups = 20,
  ...options
}: CountOptions): Promise<CountResult> {
  if (options.regex) return { error: 'count_events does not support regex queries' }
  // Counting everything ever retained is rarely what's wanted
  const since = options.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  let valueExpr
  if (groupBy.startsWith('extra.')) {
    const key = groupBy.slice('extra.'.length)
    if (!EXTRA_KEY.test(key)) return { error: `Invalid extra field name: ${key}` }
    valueExpr = sql`json_extract(extra, ${'$.' + key})`
  } else if (groupBy in GROUP_COLUMNS) {
    valueExpr = GROUP_COLUMNS[groupBy as keyof typeof GROUP_COLUMNS]
  } else {
    return { error: `groupBy must be one of: ${GROUP_BY_FIELDS.join(', ')}` }
  }

  const built = buildFilter({ ...options, since })
  if ('error' in built) return built
  const rows = await built.filtered
    .select((eb) => [
      valueExpr.as('value'),
      eb.fn.countAll<number>().as('count'),
      eb.fn.min('ts').as('firstSeen'),
      eb.fn.max('ts').as('lastSeen'),
    ])
    .groupBy(valueExpr)
    .orderBy('count', 'desc')
    .orderBy('lastSeen', 'desc')
    .limit(groups + 1)
    .execute()

  const shown = rows.slice(0, groups) as unknown as Extract<
    CountResult,
    { groups: unknown }
  >['groups']
  return {
    groupBy,
    since,
    totalMatches: shown.reduce((n, g) => n + g.count, 0),
    groups: shown,
    truncated: rows.length > groups,
  }
}
