import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('events')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement())
    .addColumn('app', 'text', (c) => c.notNull())
    .addColumn('ts', 'text', (c) => c.notNull())
    .addColumn('received_at', 'text', (c) => c.notNull())
    .addColumn('level', 'text', (c) =>
      c.check(sql`level in ('error', 'warn', 'info', 'debug', 'success')`),
    )
    .addColumn('msg', 'text', (c) => c.notNull())
    .addColumn('code', 'text')
    .addColumn('req_id', 'text')
    .addColumn('method', 'text')
    .addColumn('path', 'text')
    .addColumn('route', 'text')
    .addColumn('status', 'integer')
    .addColumn('duration_ms', 'integer')
    .addColumn('user_id', 'text')
    .addColumn('release', 'text')
    .addColumn('stack', 'text')
    .addColumn('fingerprint', 'text')
    .addColumn('extra', 'text', (c) => c.check(sql`extra is null or json_valid(extra)`))
    .execute()

  // Per-app paging in the log viewer
  await db.schema.createIndex('events_app_id').on('events').columns(['app', 'id']).execute()
  // Dashboard time windows
  await db.schema.createIndex('events_level_ts').on('events').columns(['level', 'ts']).execute()
  // Retention
  await db.schema.createIndex('events_received_at').on('events').column('received_at').execute()
  // Issue drill-down
  await db.schema
    .createIndex('events_fingerprint_id')
    .on('events')
    .columns(['fingerprint', 'id'])
    .where('fingerprint', 'is not', null)
    .execute()
  // Request tracing
  await db.schema
    .createIndex('events_req_id')
    .on('events')
    .column('req_id')
    .where('req_id', 'is not', null)
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('events').execute()
}
