import { type Kysely, sql } from 'kysely'
import { DEFAULT_ENV, resolveSource } from '@/services/source'

// Events gain a service and an env. Existing per-process app names are folded into their
// product (redesign_api, talent-backend -> app talent-sales, service talent-backend).
// Fingerprints hash the service, which equals the old app name for SDK events, so issue
// states keep matching.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('events')
    .addColumn('service', 'text', (c) => c.notNull().defaultTo(''))
    .execute()
  await db.schema
    .alterTable('events')
    .addColumn('env', 'text', (c) => c.notNull().defaultTo(DEFAULT_ENV))
    .execute()

  const apps = await db.selectFrom('events').select('app').distinct().execute()
  for (const { app } of apps) {
    const source = resolveSource(app)
    await db
      .updateTable('events')
      .set({ app: source.app, service: source.service })
      .where('app', '=', app)
      .execute()
  }

  // Events that carried their own env keep it
  await sql`update events set env = lower(json_extract(extra, '$.env'))
    where json_extract(extra, '$.env') is not null
      and trim(json_extract(extra, '$.env')) != ''`.execute(db)

  await db.schema
    .createIndex('events_app_env_service_id')
    .on('events')
    .columns(['app', 'env', 'service', 'id'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('events_app_env_service_id').execute()
  await db.schema.alterTable('events').dropColumn('env').execute()
  await db.schema.alterTable('events').dropColumn('service').execute()
}
