import type { Kysely } from 'kysely'

// Per-app dashboard windows: counts by level over a time range, newest event and error
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createIndex('events_app_level_ts')
    .on('events')
    .columns(['app', 'level', 'ts'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('events_app_level_ts').execute()
}
