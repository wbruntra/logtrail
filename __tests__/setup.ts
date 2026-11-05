import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Preloaded by bunfig.toml before any test file, so modules that read these at
// import time (database/db.ts, services/ingest-store.ts) never touch real data.
process.env.LOGTRAIL_DB = ':memory:'
process.env.LOGTRAIL_INGEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'logtrail-ingest-'))

const { migrateToLatest } = await import('@database/migrate')
await migrateToLatest()
