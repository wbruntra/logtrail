import secrets from '@/secrets'
import { parseIngestPayload } from '@/services/event-schema'
import { insertEvents, insertLines } from '@/services/event-store'
import { Hono } from 'hono'

const router = new Hono()

// Agent key auth — separate from the user JWT used by the browser UI
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

  if (payload.kind === 'lines') {
    await insertLines(payload.app, payload.lines)
    return c.json({ ok: true, written: payload.lines.length })
  }

  const { app, events, rejected } = payload
  if (!events.length) {
    return c.json({ error: 'No valid events', rejected }, 400)
  }
  const rows = await insertEvents(app, events)
  return c.json({ ok: true, written: rows.length, ...(rejected.length ? { rejected } : {}) })
})

export default router
