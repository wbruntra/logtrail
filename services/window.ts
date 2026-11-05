import type { Series, Window } from '@/shared/api-types'
import { type RawBuilder, sql } from 'kysely'
import { getRetentionDays } from './config'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

export const DEFAULT_HOURS = 24

/** Bucket widths that keep charts between roughly 24 and 48 columns. */
function bucketFor(hours: number): number {
  if (hours <= 1) return 2 * MINUTE
  if (hours <= 6) return 15 * MINUTE
  if (hours <= 24) return 30 * MINUTE
  if (hours <= 72) return 2 * HOUR
  return Math.ceil(hours / 36) * HOUR
}

export const maxHours = () => getRetentionDays() * 24

/**
 * The last `hours` (clamped to retention), ending at the end of the current
 * bucket so buckets stay aligned across refreshes.
 */
export function makeWindow(hours: number | string | undefined, now = new Date()): Window {
  const n = typeof hours === 'number' ? hours : parseInt(hours ?? '', 10)
  const h = Math.min(Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_HOURS, maxHours())
  const bucketMs = bucketFor(h)
  const count = Math.ceil((h * HOUR) / bucketMs)
  const end = Math.ceil((now.getTime() + 1) / bucketMs) * bucketMs
  const start = end - count * bucketMs
  return {
    hours: h,
    since: new Date(start).toISOString(),
    until: new Date(end).toISOString(),
    bucketMs,
    buckets: Array.from({ length: count }, (_, i) => new Date(start + i * bucketMs).toISOString()),
  }
}

/** SQL expression for the index of the window bucket an event's ts falls in. */
export function bucketOf(window: Window): RawBuilder<number> {
  const start = Date.parse(window.since)
  return sql<number>`cast((unixepoch(ts) * 1000 - ${start}) / ${window.bucketMs} as integer)`
}

/** Counts per bucket, with zeros for empty buckets. Out-of-range rows are dropped. */
export function toSeries(window: Window, rows: { bucket: number; count: number }[]): Series {
  const series = new Array<number>(window.buckets.length).fill(0)
  for (const { bucket, count } of rows) {
    if (bucket >= 0 && bucket < series.length) series[bucket] += count
  }
  return series
}
