import type { Generated, Insertable, Selectable } from 'kysely'

export const LEVELS = ['error', 'warn', 'info', 'debug', 'success'] as const
export type Level = (typeof LEVELS)[number]

export interface EventsTable {
  id: Generated<number>
  /** The product or codebase, e.g. talent-sales. */
  app: string
  /** The process within the app, e.g. an api or a worker. */
  service: string
  /** production, staging, ... */
  env: string
  /** When the event happened: client clock, clamped near received_at. ISO-8601 UTC. */
  ts: string
  /** When logtrail received the event. ISO-8601 UTC. Retention uses this. */
  received_at: string
  /** NULL for unstructured lines from the retired log-shipping agent. */
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

export const ISSUE_STATUSES = ['resolved', 'muted'] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]

/** Triage state of an issue. Open issues have no row. */
export interface IssueStatesTable {
  fingerprint: string
  status: IssueStatus
  /** When the status was set. A resolved issue seen after this reopens. */
  changed_at: string
}

export interface Database {
  events: EventsTable
  issue_states: IssueStatesTable
}

export type EventRow = Selectable<EventsTable>
export type NewEventRow = Insertable<EventsTable>
