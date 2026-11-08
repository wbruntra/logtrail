import type { Kysely } from 'kysely'
import { refingerprint } from '@/services/fingerprint-backfill'

// Fingerprints now fold the values of identity-like key=value pairs in a message
// (account=name, token=1) so a per-account line stops being one issue per account.
// Recompute the stored ones to merge those issues, carrying triage states over.
export async function up(db: Kysely<any>): Promise<void> {
  await refingerprint(db)
}

export async function down(): Promise<void> {}
