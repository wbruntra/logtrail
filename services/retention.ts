import { db } from '@database/db'
import { getRetentionDays } from './config'

const BATCH = 5000
const INTERVAL_MS = 60 * 60 * 1000

/** Receipt time before which events are expired. */
export function retentionCutoff(now = new Date()): string {
  return new Date(now.getTime() - getRetentionDays() * 24 * 60 * 60 * 1000).toISOString()
}

/** Deletes expired events in batches, so ingest isn't blocked behind one long write. */
export async function deleteExpired(now = new Date()): Promise<number> {
  const cutoff = retentionCutoff(now)
  let deleted = 0
  for (;;) {
    const result = await db
      .deleteFrom('events')
      .where('id', 'in', (eb) =>
        eb.selectFrom('events').select('id').where('received_at', '<', cutoff).limit(BATCH),
      )
      .executeTakeFirst()
    const n = Number(result.numDeletedRows)
    deleted += n
    if (n < BATCH) return deleted
  }
}

/** Runs retention now and then hourly. The period is re-read from config each run. */
export function startRetention(): void {
  const run = () =>
    deleteExpired()
      .then(
        (n) =>
          n && console.log(`[retention] deleted ${n} events older than ${getRetentionDays()}d`),
      )
      .catch((err) => console.error('[retention] failed:', err))
  void run()
  setInterval(run, INTERVAL_MS).unref()
}
