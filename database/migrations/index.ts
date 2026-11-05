import type { Migration } from 'kysely/migration'
import * as m001 from './001_events'

// Listed explicitly rather than read from disk, so the set of migrations is
// fixed at build time and ordering never depends on the filesystem.
export const migrations: Record<string, Migration> = {
  '001_events': m001,
}
