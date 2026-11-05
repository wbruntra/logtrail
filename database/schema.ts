import type { Generated, Insertable, Selectable } from 'kysely'

export const LEVELS = ['error', 'warn', 'info', 'debug', 'success'] as const
export type Level = (typeof LEVELS)[number]

export interface EventsTable {
  id: Generated<number>
  app: string
  /** When the event happened: client clock, clamped near received_at. ISO-8601 UTC. */
  ts: string
  /** When logtrail received the event. ISO-8601 UTC. Retention uses this. */
  received_at: string
  /** NULL for unstructured lines shipped by the agent. */
  level: Level | null
  msg: string
  code: string | null
  req_id: string | null
  method: string | null
  /** Concrete request path, e.g. /users/123 */
  path: string | null
  /** Route pattern, e.g. /users/:id */
  route: string | null
  status: number | null
  duration_ms: number | null
  user_id: string | null
  release: string | null
  stack: string | null
  /** Groups recurring errors/warnings into issues. NULL for other levels. */
  fingerprint: string | null
  /** JSON object holding any fields without a dedicated column. */
  extra: string | null
}

export interface Database {
  events: EventsTable
}

export type EventRow = Selectable<EventsTable>
export type NewEventRow = Insertable<EventsTable>
