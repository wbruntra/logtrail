import { db } from '@database/db'
import type { EventRow } from '@database/schema'
import { sql } from 'kysely'
import { getNeighbors, listApps, type LogLine, toLine } from './event-query'

// Searches ingested events. Plain queries match in SQL against the event's text
// fields; regex queries are narrowed by the other filters in SQL, then matched in
// JS against the rendered line (bun:sqlite cannot register a REGEXP function).

const REGEX_BATCH = 5000

// Everything a rendered line shows, so substring and regex search see the same text
const SEARCH_TEXT = sql<string>`ts || ' ' || ifnull(level, '') || ' ' || msg || ' ' ||
  ifnull(code, '') || ' ' || ifnull(method, '') || ' ' || ifnull(path, '') || ' ' ||
  ifnull(route, '') || ' ' || ifnull(status, '') || ' ' || ifnull(req_id, '') || ' ' ||
  ifnull(user_id, '') || ' ' || ifnull(release, '') || ' ' || ifnull(stack, '') || ' ' ||
  ifnull(extra, '')`

export interface SearchOptions {
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
  /** Lines of the same app to include before and after each match */
  context?: number
  limit?: number
}

export interface SearchMatch extends LogLine {
  app: string
  ts: string
  context?: LogLine[]
}

export type SearchResult =
  | { appsSearched: string[]; totalMatches: number; truncated: boolean; results: SearchMatch[] }
  | { error: string }

function isoBound(value: string | undefined): string | null | undefined {
  if (!value) return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

/** Returns the newest `limit` matches in chronological order. */
export async function searchLogs({
  app,
  query,
  regex = false,
  caseSensitive = false,
  reqId,
  since,
  until,
  context = 0,
  limit = 100,
}: SearchOptions): Promise<SearchResult> {
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

  let filtered = db.selectFrom('events')
  if (app) filtered = filtered.where('app', '=', app)
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

  const chronological = newest.sort((a, b) => a.ts.localeCompare(b.ts) || a.id - b.id)
  const results = await Promise.all(
    chronological.map(async (row): Promise<SearchMatch> => {
      const match: SearchMatch = { app: row.app, ts: row.ts, ...toLine(row) }
      if (context > 0) {
        const { before, after } = await getNeighbors(row.app, row.id, context)
        match.context = [...before, ...after].map(toLine)
      }
      return match
    }),
  )

  return {
    appsSearched: app ? [app] : await listApps(),
    totalMatches,
    truncated: totalMatches > results.length,
    results,
  }
}
