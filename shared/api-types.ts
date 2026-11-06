// Response shapes of the dashboard API (/api/apps, /api/issues, /api/events).
// Imported by the services that build them and by preact-client, so this file
// must stay free of runtime imports.

export type Level = 'error' | 'warn' | 'info' | 'debug' | 'success'
export type AlertLevel = 'error' | 'warn'

/**
 * Open issues need attention. Resolved ones reopen (as regressed) when they
 * happen again; muted ones stay hidden and leave the dashboard's counts.
 */
export type IssueState = 'open' | 'resolved' | 'muted'

/** The time range a response covers, split into equal buckets for charts. */
export interface Window {
  hours: number
  since: string
  until: string
  bucketMs: number
  /** Start of each bucket, oldest first */
  buckets: string[]
}

/** One count per bucket of the response's window */
export type Series = number[]

export interface AppSummary {
  app: string
  /** 'lines' apps ship raw text through the agent, so they have no levels or issues */
  kind: 'structured' | 'lines'
  events: number
  errors: number
  warns: number
  /** Open issues seen in the window */
  issues: number
  /** Open issues whose first retained occurrence falls in the window */
  newIssues: number
  lastEventAt: string | null
  lastErrorAt: string | null
  errorSeries: Series
  warnSeries: Series
  /** All events, any level */
  volumeSeries: Series
}

export interface Overview {
  window: Window
  /** Every environment that has sent events, for the env switcher */
  envs: string[]
  totals: {
    events: number
    errors: number
    warns: number
    issues: number
    newIssues: number
    /** Errors and warnings left out of the counts above because their issue is muted */
    muted: number
  }
  apps: AppSummary[]
}

export interface IssueSummary {
  fingerprint: string
  app: string
  service: string
  level: AlertLevel
  msg: string
  code: string | null
  method: string | null
  /** Route pattern, or the request path with ids replaced */
  route: string | null
  status: number | null
  /** Occurrences in the window */
  count: number
  /** Distinct users in the window */
  users: number
  /** Earliest occurrence still retained, regardless of the window */
  firstSeen: string
  lastSeen: string
  isNew: boolean
  state: IssueState
  /** Open again because it happened after being resolved */
  regressed: boolean
  /** When it was last resolved or muted */
  stateChangedAt: string | null
  releases: string[]
  latestId: number
  series: Series
}

export interface Breakdown {
  value: string
  count: number
}

export interface RouteHealth {
  method: string | null
  route: string
  errors: number
  warns: number
}

/** One process of an app over the window */
export interface ServiceSummary {
  service: string
  events: number
  errors: number
  warns: number
  lastEventAt: string | null
}

export interface AppDetail {
  app: string
  envs: string[]
  /** Services in the selected env, regardless of the service filter */
  services: ServiceSummary[]
  kind: 'structured' | 'lines'
  window: Window
  /** Errors and warnings exclude muted issues; `muted` counts those left out */
  totals: { events: number; errors: number; warns: number; muted: number }
  errorSeries: Series
  warnSeries: Series
  volumeSeries: Series
  issues: IssueSummary[]
  routes: RouteHealth[]
  statuses: Breakdown[]
  releases: Breakdown[]
  lastEventAt: string | null
}

/** An event with every column present (null when unset) and `extra` parsed. */
export interface EventView {
  id: number
  app: string
  service: string
  env: string
  ts: string
  receivedAt: string
  level: Level | null
  msg: string
  code: string | null
  reqId: string | null
  method: string | null
  path: string | null
  route: string | null
  status: number | null
  duration: number | null
  userId: string | null
  release: string | null
  stack: string | null
  fingerprint: string | null
  extra: Record<string, unknown> | null
}

export interface EventPage {
  events: EventView[]
  /** Pass as `before` to get the next (older) page; null when there is none */
  nextBefore: number | null
}

export interface IssueDetail extends IssueSummary {
  window: Window
  /** Occurrences retained, any time */
  totalCount: number
  /** The most recent stack trace recorded for this issue */
  stack: string | null
  breakdowns: {
    releases: Breakdown[]
    paths: Breakdown[]
    statuses: Breakdown[]
    users: Breakdown[]
  }
  occurrences: EventPage
}

export interface EventDetail {
  event: EventView
  /** Every event sharing the request id, across apps, oldest first */
  trace: EventView[]
  /** Events of the same app just before and after, oldest first */
  before: EventView[]
  after: EventView[]
}
