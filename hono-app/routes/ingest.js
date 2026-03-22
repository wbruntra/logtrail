const { Hono } = require('hono')
const { writeEntry, writeBatch } = require('@/services/ingest-store')
const secrets = require('@/secrets')

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

const KNOWN_LEVELS = new Set(['error', 'warn', 'info', 'debug', 'success'])

// POST /api/ingest
//
// Structured event (new):
//   { app, level, msg, code?, reqId?, method?, path?, status?, duration?, userId?, stack?, ... }
//
// Legacy plain text (still supported):
//   Single: { app, msg }
//   Batch:  { app, lines: string[] }
router.post('/', async (c) => {
  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { app, msg, lines, level, ...rest } = body

  if (!app || typeof app !== 'string' || !app.trim()) {
    return c.json({ error: 'app field is required' }, 400)
  }

  const appName = app.trim()

  // Structured event — has a recognised level field
  if (level && KNOWN_LEVELS.has(level.toLowerCase())) {
    if (!msg || typeof msg !== 'string' || !msg.trim()) {
      return c.json({ error: 'msg is required for structured events' }, 400)
    }
    writeEntry(appName, { level: level.toLowerCase(), msg: msg.trim(), ...rest })
    return c.json({ ok: true, written: 1 })
  }

  // Legacy batch
  if (Array.isArray(lines)) {
    const valid = lines.filter((l) => typeof l === 'string' && l.trim())
    if (!valid.length) return c.json({ error: 'No valid lines provided' }, 400)
    writeBatch(appName, valid)
    return c.json({ ok: true, written: valid.length })
  }

  // Legacy single
  if (msg && typeof msg === 'string' && msg.trim()) {
    writeEntry(appName, msg.trim())
    return c.json({ ok: true, written: 1 })
  }

  return c.json({ error: 'msg (string), lines (array), or structured event with level required' }, 400)
})

module.exports = router
