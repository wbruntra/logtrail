import type { Kysely } from 'kysely'
import { refingerprint } from '@/services/fingerprint-backfill'

// Fingerprints now fold short ids such as /roster-view/2ExX98E into :id, so
// recompute the stored ones to merge issues that differed only by such ids.
export async function up(db: Kysely<any>): Promise<void> {
  await refingerprint(db)
}

export async function down(): Promise<void> {}
