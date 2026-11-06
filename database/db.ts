import { Database as Sqlite } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { Kysely } from 'kysely'
import { BunSqliteDialect } from 'kysely-bun-dialects/sqlite'
import type { Database } from './schema'

/** Database file. Set LOGTRAIL_DB=:memory: for tests. */
export const DB_PATH = process.env.LOGTRAIL_DB ?? path.join(process.cwd(), 'data', 'logtrail.db')

function open(file: string): Sqlite {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true })
  const sqlite = new Sqlite(file, { create: true })
  // WAL lets the viewer read while ingest writes; NORMAL is durable enough for logs.
  sqlite.run('PRAGMA journal_mode = WAL')
  sqlite.run('PRAGMA synchronous = NORMAL')
  sqlite.run('PRAGMA busy_timeout = 5000')
  sqlite.run('PRAGMA foreign_keys = ON')
  return sqlite
}

export const db = new Kysely<Database>({
  dialect: new BunSqliteDialect({ database: open(DB_PATH) }),
})
