// Preloaded by bunfig.toml before any test file, so database/db.ts opens an
// in-memory database instead of the real one.
process.env.LOGTRAIL_DB = ':memory:'

const { migrateToLatest } = await import('@database/migrate')
await migrateToLatest()

export {}
