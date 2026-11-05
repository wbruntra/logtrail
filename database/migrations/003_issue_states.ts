import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('issue_states')
    .addColumn('fingerprint', 'text', (c) => c.primaryKey())
    .addColumn('status', 'text', (c) => c.notNull().check(sql`status in ('resolved', 'muted')`))
    .addColumn('changed_at', 'text', (c) => c.notNull())
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('issue_states').execute()
}
