import { db } from '@database/db'
import type { EventRow, Level } from '@database/schema'
import type { EventView } from '@/shared/api-types'
import { sql } from 'kysely'
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

/** The newest `limit` matching rows in chronological order, with the count of all matches. */
async function findMatches({
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
  limit = 100,
}: SearchOptions): Promise<{ rows: EventRow[]; totalMatches: number } | { error: string }> {
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
  if (query && !re) {
    filtered = filtered.where(
      caseSensitive
        ? sql<boolean>`instr(${SEARCH_TEXT}, ${query}) > 0`
        : sql<boolean>`instr(lower(${SEARCH_TEXT}), lower(${query})) > 0`,
    )
  }

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
