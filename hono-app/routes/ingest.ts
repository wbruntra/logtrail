import secrets from '@/secrets'
import { parseIngestPayload } from '@/services/event-schema'
import { insertEvents } from '@/services/event-store'
import { Hono } from 'hono'

const router = new Hono()

// Shared-secret auth — separate from the user JWT used by the browser UI
router.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token || token !== secrets.agentSecret) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return next()
})

// POST /api/ingest — payload shapes are documented in services/event-schema.ts
router.post('/', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const payload = parseIngestPayload(body)

  if (payload.kind === 'invalid') {
    return c.json({ error: payload.error }, 400)
  }

  const { source, events, rejected } = payload
  if (!events.length) {
    return c.json({ error: 'No valid events', rejected }, 400)
  }
  const rows = await insertEvents(source.app, events, source)
  return c.json({ ok: true, written: rows.length, ...(rejected.length ? { rejected } : {}) })
})

export default router
