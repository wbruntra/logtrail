import { db } from '@database/db'
import type { EventRow } from '@database/schema'
import { eventEmitter, toEvent } from './event-store'

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

async function countLines(app: string): Promise<number> {
  const { n } = await db
    .selectFrom('events')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('app', '=', app)
    .executeTakeFirstOrThrow()
  return n
}

/** Up to `limit` lines before the `before` cursor (or the newest), oldest first. */
export async function getHistory(app: string, before?: number, limit = 100) {
  let query = db
    .selectFrom('events')
    .selectAll()
    .where('app', '=', app)
    .orderBy('id', 'desc')
    .limit(limit + 1)
  if (before !== undefined) query = query.where('id', '<', before)

  const [rows, totalLines] = await Promise.all([query.execute(), countLines(app)])
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
