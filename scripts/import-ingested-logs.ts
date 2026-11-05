#!/usr/bin/env bun

// One-off: load the legacy ingested-logs/<app>/<YYYY-MM-DD>.log files into the database.
//
//   bun scripts/import-ingested-logs.ts [dir]      (default: ./ingested-logs)
//
// Lines from before an app's earliest stored event are imported; later ones are skipped,
// since ingest already stored them. That makes it safe to re-run. Imported events keep
// their original timestamps, so retention expires them on the usual schedule.

import fs from 'node:fs'
import path from 'node:path'
import { db } from '@database/db'
import { migrateToLatest } from '@database/migrate'
import type { NewEventRow } from '@database/schema'
import { eventSchema } from '@/services/event-schema'
import { toRow } from '@/services/event-store'

const BATCH = 500

/** A file-store line as a row: JSON lines are structured events, others are "<ts> <msg>". */
export function parseLine(app: string, line: string): NewEventRow | null {
  if (line.startsWith('{')) {
    try {
      const obj = JSON.parse(line)
      const ms = Date.parse(obj.ts)
      const parsed = eventSchema.safeParse(obj)
      if (!Number.isNaN(ms) && parsed.success) return toRow(app, parsed.data, new Date(ms))
    } catch {}
  }
  const space = line.indexOf(' ')
  const ms = space > 0 ? Date.parse(line.slice(0, space)) : NaN
  if (Number.isNaN(ms)) return null
  const ts = new Date(ms).toISOString()
  return { app, ts, received_at: ts, level: null, msg: line.slice(space + 1) }
}

async function importApp(app: string, dir: string): Promise<void> {
  const { first } = await db
    .selectFrom('events')
    .select((eb) => eb.fn.min('ts').as('first'))
    .where('app', '=', app)
    .executeTakeFirstOrThrow()

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.log'))
    .sort()
  const rows: NewEventRow[] = []
  let unreadable = 0
  let alreadyStored = 0
  for (const file of files) {
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
      if (!line.trim()) continue
      const row = parseLine(app, line)
      if (!row) unreadable++
      else if (first && row.ts >= first) alreadyStored++
      else rows.push(row)
    }
  }

  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      await trx
        .insertInto('events')
        .values(rows.slice(i, i + BATCH))
        .execute()
    }
  })
  console.log(
    `${app}: imported ${rows.length}, skipped ${alreadyStored} already stored, ${unreadable} unreadable`,
  )
}

if (import.meta.main) {
  const dir = path.resolve(process.argv[2] ?? 'ingested-logs')
  if (!fs.existsSync(dir)) {
    console.error(`No such directory: ${dir}`)
    process.exit(1)
  }
  await migrateToLatest()
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await importApp(entry.name, path.join(dir, entry.name))
  }
}
