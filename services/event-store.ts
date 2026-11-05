import { EventEmitter } from 'node:events'
import { db } from '@database/db'
import type { EventRow, Level, NewEventRow } from '@database/schema'
import type { IngestEvent } from './event-schema'
import { fingerprint } from './fingerprint'

const MAX_FUTURE_MS = 5 * 60 * 1000
const MAX_PAST_MS = 24 * 60 * 60 * 1000
const MAX_EXTRA = 16000

// Emits 'events' with the inserted EventRow[] for live-stream subscribers.
export const eventEmitter = new EventEmitter()
eventEmitter.setMaxListeners(100)

const COLUMN_FIELDS = new Set([
  'ts',
  'level',
  'msg',
  'code',
  'reqId',
  'method',
  'path',
  'route',
  'status',
  'duration',
  'userId',
  'release',
  'stack',
])

/** Trust the client clock unless it's missing or implausibly far from receipt time. */
export function resolveTs(clientTs: string | null | undefined, receivedAt: Date): string {
  if (clientTs) {
    const ms = Date.parse(clientTs)
    const received = receivedAt.getTime()
    if (ms >= received - MAX_PAST_MS && ms <= received + MAX_FUTURE_MS) {
      return new Date(ms).toISOString()
    }
  }
  return receivedAt.toISOString()
}

function extraJson(e: IngestEvent): string | null {
  const extra = Object.fromEntries(
    Object.entries(e).filter(([k, v]) => !COLUMN_FIELDS.has(k) && v !== undefined && v !== null),
  )
  if (!Object.keys(extra).length) return null
  const json = JSON.stringify(extra)
  return json.length > MAX_EXTRA ? JSON.stringify({ _truncated: true }) : json
}

export function toRow(app: string, e: IngestEvent, receivedAt: Date): NewEventRow {
  const method = e.method?.toUpperCase() ?? null
  const row = {
    app,
    ts: resolveTs(e.ts, receivedAt),
    received_at: receivedAt.toISOString(),
    level: e.level,
    msg: e.msg,
    code: e.code ?? null,
    req_id: e.reqId ?? null,
    method,
    path: e.path ?? null,
    route: e.route ?? null,
    status: e.status ?? null,
    duration_ms: e.duration == null ? null : Math.round(e.duration),
    user_id: e.userId ?? null,
    release: e.release ?? null,
    stack: e.stack ?? null,
    extra: extraJson(e),
  }
  return { ...row, fingerprint: fingerprint(row) }
}

/** The camelCase event shape clients send and the viewer renders. Null fields are omitted. */
export interface EventJson {
  ts: string
  level: Level | null
  msg: string
  code?: string
  reqId?: string
  method?: string
  path?: string
  route?: string
  status?: number
  duration?: number
  userId?: string
  release?: string
  stack?: string
  [field: string]: unknown
}

export function toEvent(row: EventRow): EventJson {
  const event: Record<string, unknown> = {
    ts: row.ts,
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
    ...(row.extra ? JSON.parse(row.extra) : {}),
  }
  return Object.fromEntries(Object.entries(event).filter(([, v]) => v !== null)) as EventJson
}

async function insert(rows: NewEventRow[]): Promise<EventRow[]> {
  if (!rows.length) return []
  const inserted = await db.insertInto('events').values(rows).returningAll().execute()
  eventEmitter.emit('events', inserted)
  return inserted
}

export function insertEvents(app: string, events: IngestEvent[]): Promise<EventRow[]> {
  const receivedAt = new Date()
  return insert(events.map((e) => toRow(app, e, receivedAt)))
}

/** Unstructured lines (from the agent) are stored with level NULL. */
export function insertLines(app: string, lines: string[]): Promise<EventRow[]> {
  const now = new Date().toISOString()
  return insert(lines.map((msg) => ({ app, ts: now, received_at: now, level: null, msg })))
}
