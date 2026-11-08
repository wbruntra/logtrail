import type { Migration } from 'kysely/migration'
import * as m001 from './001_events'
import * as m002 from './002_app_level_ts'
import * as m003 from './003_issue_states'
import * as m004 from './004_refingerprint_slug_ids'
import * as m005 from './005_app_service_env'
import * as m006 from './006_refingerprint_key_values'

// Listed explicitly rather than read from disk, so the set of migrations is
// fixed at build time and ordering never depends on the filesystem.
export const migrations: Record<string, Migration> = {
  '001_events': m001,
  '002_app_level_ts': m002,
  '003_issue_states': m003,
  '004_refingerprint_slug_ids': m004,
  '005_app_service_env': m005,
  '006_refingerprint_key_values': m006,
}
