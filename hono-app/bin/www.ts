#!/usr/bin/env bun

import { migrateToLatest } from '@database/migrate'
import { startRetention } from '@/services/retention'
import app from '../app'
import { logtrail } from '../self-log'

// No top-level await: pm2 loads this file with require(), which can't load async modules.
async function main() {
  await migrateToLatest()
  startRetention()
  logtrail.captureProcessErrors()

  const port = parseInt(process.env.PORT || '12070', 10)

  const server = Bun.serve({
    port,
    fetch: app.fetch,
    idleTimeout: 0,
  })

  console.log(`Hono server listening on port ${server.port}`)
}

main().catch((err) => {
  console.error('Failed to start:', err)
  process.exit(1)
})
