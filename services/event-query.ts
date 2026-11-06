import { db } from '@database/db'
import type { EventRow, Level } from '@database/schema'
import type { EventDetail, EventPage, EventView } from '@/shared/api-types'
import { sql } from 'kysely'
import { eventEmitter, toEvent } from './event-store'
import { type Scope, inScope } from './scope'

// Read side of the event store, shaped for the log viewer and MCP: each event is
// a "line" whose lineNumber is the row id (a stable cursor, not a position).

export interface LogLine {
  lineNumber: number
  content: string
}

/** Structured events render as JSON, agent lines as "<ts> <msg>", as the file store wrote them. */
export function toLine(row: EventRow): LogLine {
  return {
    lineNumber: row.id,
    content: row.level === null ? `${row.ts} ${row.msg}` : JSON.stringify(toEvent(row)),
  }
}

export async function listApps(): Promise<string[]> {
  const rows = await db.selectFrom('events').select('app').distinct().orderBy('app').execute()
  return rows.map((r) => r.app)
}

export interface AppStats {
  app: string
  eventCount: number
  /** Events from the SDK or ingest API, with level and fields */
  structured: number
  /** Plain text lines shipped by the agent */
  unstructured: number
  /** Processes that have sent events, and the environments they sent from */
  services: string[]
  envs: string[]
  firstSeen: string
  lastSeen: string
}

/** Per app: retained event counts and the oldest and newest event times. */
export async function appStats(): Promise<AppStats[]> {
  const rows = await db
    .selectFrom('events')
    .select((eb) => [
      'app',
      eb.fn.countAll<number>().as('eventCount'),
      eb.fn.count<number>('level').as('structured'),
      eb.fn.min('ts').as('firstSeen'),
      eb.fn.max('ts').as('lastSeen'),
      sql<string>`group_concat(distinct service)`.as('services'),
      sql<string>`group_concat(distinct env)`.as('envs'),
    ])
    .groupBy('app')
    .orderBy('app')
    .execute()
  return rows.map((r) => ({
    ...r,
    unstructured: r.eventCount - r.structured,
    services: r.services.split(',').sort(),
    envs: r.envs.split(',').sort(),
  }))
}

async function countLines(app: string, scope: Scope = {}): Promise<number> {
  const { n } = await inScope(db.selectFrom('events'), scope)
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('app', '=', app)
    .executeTakeFirstOrThrow()
  return n
}

/** Up to `limit` lines before the `before` cursor (or the newest), oldest first. */
export async function getHistory(app: string, before?: number, limit = 100, scope: Scope = {}) {
  let query = inScope(db.selectFrom('events'), scope)
    .selectAll()
    .where('app', '=', app)
    .orderBy('id', 'desc')
    .limit(limit + 1)
  if (before !== undefined) query = query.where('id', '<', before)

  const [rows, totalLines] = await Promise.all([query.execute(), countLines(app, scope)])
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit).reverse()
  return {
    lines: page.map(toLine),
    hasMore,
    nextBefore: hasMore ? page[0].id : null,
    totalLines,
  }
}

export async function getTail(app: string, limit = 100): Promise<string> {
  const { lines } = await getHistory(app, undefined, limit)
  return lines.map((l) => l.content).join('\n')
}

/** Up to `count` events of the same app on each side of `id`, in order, excluding `id`. */
export async function getNeighbors(app: string, id: number, count: number) {
  if (count <= 0) return { before: [], after: [] }
  const near = db.selectFrom('events').selectAll().where('app', '=', app).limit(count)
  const [before, after] = await Promise.all([
    near.where('id', '<', id).orderBy('id', 'desc').execute(),
    near.where('id', '>', id).orderBy('id', 'asc').execute(),
  ])
  return { before: before.reverse(), after }
}

export async function getContext(app: string, id: number, contextLines: number) {
  const target = await db
    .selectFrom('events')
    .selectAll()
    .where('app', '=', app)
    .where('id', '=', id)
    .executeTakeFirst()
  if (!target) return null

  const [{ before, after }, totalLines] = await Promise.all([
    getNeighbors(app, id, contextLines),
    countLines(app),
  ])
  const rows = [...before, target, ...after]
  return {
    targetLine: id,
    contextLines,
    startLine: rows[0].id,
    endLine: rows[rows.length - 1].id,
    totalLines,
    lines: rows.map((r) => ({ ...toLine(r), isTarget: r.id === id })),
  }
}

/** Calls onLine for each event stored for `app` from now on. Returns an unsubscribe function. */
export function subscribe(app: string, onLine: (line: LogLine) => void): () => void {
  const listener = (rows: EventRow[]) => {
    for (const row of rows) if (row.app === app) onLine(toLine(row))
  }
  eventEmitter.on('events', listener)
  return () => eventEmitter.off('events', listener)
}

// Everything a rendered line shows, so substring and regex search see the same text
export const SEARCH_TEXT = sql<string>`ts || ' ' || ifnull(level, '') || ' ' || msg || ' ' ||
  ifnull(code, '') || ' ' || ifnull(method, '') || ' ' || ifnull(path, '') || ' ' ||
  ifnull(route, '') || ' ' || ifnull(status, '') || ' ' || ifnull(req_id, '') || ' ' ||
  ifnull(user_id, '') || ' ' || ifnull(release, '') || ' ' || ifnull(stack, '') || ' ' ||
  ifnull(extra, '')`

export function toEventView(row: EventRow): EventView {
  return {
    id: row.id,
    app: row.app,
    service: row.service,
    env: row.env,
    ts: row.ts,
    receivedAt: row.received_at,
    level: row.level,
    msg: row.msg,
    code: row.code,
    reqId: row.req_id,
    method: row.method,
    path: row.path,
    route: row.route,
    status: row.status,
    duration: row.duration_ms,
    userId: row.user_id,
    release: row.release,
    stack: row.stack,
    fingerprint: row.fingerprint,
    extra: row.extra ? JSON.parse(row.extra) : null,
  }
}

/** A level, or 'none' for the agent's unstructured lines */
export type LevelFilter = Level | 'none'

export interface EventFilter extends Scope {
  app?: string
  fingerprint?: string
  levels?: LevelFilter[]
  /** Case-insensitive substring of any text field */
  q?: string
  reqId?: string
  /** Id cursor: only events older than this */
  before?: number
  /** Id cursor: only events newer than this, e.g. to catch up after a stream reconnects */
  after?: number
  limit?: number
}

/** Matching events, newest first, a page at a time. */
export async function listEvents({
  app,
  env,
  service,
  fingerprint,
  levels,
  q,
  reqId,
  before,
  after,
  limit = 100,
}: EventFilter): Promise<EventPage> {
  const max = Math.min(Math.max(limit, 1), 500)
  let query = db
    .selectFrom('events')
    .selectAll()
    .orderBy('id', 'desc')
    .limit(max + 1)
  if (app) query = query.where('app', '=', app)
  query = inScope(query, { env, service })
  if (fingerprint) query = query.where('fingerprint', '=', fingerprint)
  if (reqId) query = query.where('req_id', '=', reqId)
  if (before !== undefined) query = query.where('id', '<', before)
  if (after !== undefined) query = query.where('id', '>', after)
  if (levels?.length) {
    const named = levels.filter((l): l is Level => l !== 'none')
    query = query.where((eb) =>
      eb.or([
        ...(named.length ? [eb('level', 'in', named)] : []),
        ...(levels.includes('none') ? [eb('level', 'is', null)] : []),
      ]),
    )
  }
  if (q?.trim()) {
    query = query.where(sql<boolean>`instr(lower(${SEARCH_TEXT}), lower(${q.trim()})) > 0`)
  }

  const rows = await query.execute()
  const page = rows.slice(0, max)
  return {
    events: page.map(toEventView),
    nextBefore: rows.length > max ? page[page.length - 1].id : null,
  }
}

/** One event with its request trace and neighboring events, or null if it has expired. */
export async function getEventDetail(id: number, neighbors = 10): Promise<EventDetail | null> {
  const row = await db.selectFrom('events').selectAll().where('id', '=', id).executeTakeFirst()
  if (!row) return null

  const [trace, { before, after }] = await Promise.all([
    row.req_id
      ? db
          .selectFrom('events')
          .selectAll()
          .where('req_id', '=', row.req_id)
          .orderBy('ts')
          .orderBy('id')
          .limit(200)
          .execute()
      : Promise.resolve([]),
    getNeighbors(row.app, id, neighbors),
  ])
  return {
    event: toEventView(row),
    trace: trace.map(toEventView),
    before: before.map(toEventView),
    after: after.map(toEventView),
  }
}

/** Calls onEvent for each new event matching the filter's app and levels. */
export function subscribeEvents(
  filter: Pick<EventFilter, 'app' | 'env' | 'service' | 'levels'>,
  onEvent: (event: EventView) => void,
): () => void {
  const listener = (rows: EventRow[]) => {
    for (const row of rows) {
      if (filter.app && row.app !== filter.app) continue
      if (filter.env && row.env !== filter.env) continue
      if (filter.service && row.service !== filter.service) continue
      if (filter.levels?.length && !filter.levels.includes(row.level ?? 'none')) continue
      onEvent(toEventView(row))
    }
  }
  eventEmitter.on('events', listener)
  return () => eventEmitter.off('events', listener)
}
