#!/usr/bin/env bun

import { migrateToLatest } from '@database/migrate'
import app from '../app'

await migrateToLatest()

const port = parseInt(process.env.PORT || '12070', 10)

const server = Bun.serve({
  port,
  fetch: app.fetch,
  idleTimeout: 0,
})

console.log(`Hono server listening on port ${server.port}`)
