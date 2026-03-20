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

// POST /api/ingest
// Single line:  { app: string, msg: string }
// Batch:        { app: string, lines: string[] }
router.post('/', async (c) => {
  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { app, msg, lines } = body

  if (!app || typeof app !== 'string' || !app.trim()) {
    return c.json({ error: 'app field is required' }, 400)
  }

  const appName = app.trim()

  if (Array.isArray(lines)) {
    const valid = lines.filter((l) => typeof l === 'string' && l.trim())
    if (!valid.length) return c.json({ error: 'No valid lines provided' }, 400)
    writeBatch(appName, valid)
    return c.json({ ok: true, written: valid.length })
  }

  if (msg && typeof msg === 'string' && msg.trim()) {
    writeEntry(appName, msg.trim())
    return c.json({ ok: true, written: 1 })
  }

  return c.json({ error: 'msg (string) or lines (array) field required' }, 400)
})

module.exports = router
