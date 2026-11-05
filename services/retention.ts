import { db } from '@database/db'

/** How long events are kept, by receipt time. */
export const RETENTION_DAYS = Number(process.env.LOGTRAIL_RETENTION_DAYS) || 3

const BATCH = 5000
const INTERVAL_MS = 60 * 60 * 1000

/** Deletes expired events in batches, so ingest isn't blocked behind one long write. */
export async function deleteExpired(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
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

/** Runs retention now and then hourly. */
export function startRetention(): void {
  const run = () =>
    deleteExpired()
      .then(
        (n) => n && console.log(`[retention] deleted ${n} events older than ${RETENTION_DAYS}d`),
      )
      .catch((err) => console.error('[retention] failed:', err))
  void run()
  setInterval(run, INTERVAL_MS).unref()
}
