import type { Kysely } from 'kysely'
import { Migrator } from 'kysely/migration'
import { db as defaultDb } from './db'
import { migrations } from './migrations'
import type { Database } from './schema'

export async function migrateToLatest(db: Kysely<Database> = defaultDb): Promise<void> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } })
  const { error, results } = await migrator.migrateToLatest()

  for (const r of results ?? []) {
    if (r.status === 'Success') console.log(`[db] applied migration ${r.migrationName}`)
    else if (r.status === 'Error') console.error(`[db] migration ${r.migrationName} failed`)
  }
  if (error) throw error
}
