import { LEVELS } from '@database/schema'
import { requireLogin } from '@/hono-app/middleware/auth'
import { holdOpen } from '@/hono-app/sse'
import {
  type EventFilter,
  getEventDetail,
  type LevelFilter,
  listEvents,
  subscribeEvents,
} from '@/services/event-query'
import { type Context, Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

const router = new Hono()
router.use('*', requireLogin)

const LEVEL_FILTERS: readonly string[] = [...LEVELS, 'none']

/** ?levels=error,warn,none */
function levelsOf(c: Context): LevelFilter[] | undefined {
  const levels = (c.req.query('levels') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is LevelFilter => LEVEL_FILTERS.includes(s))
  return levels.length ? levels : undefined
}

function filterOf(c: Context): EventFilter {
  const before = parseInt(c.req.query('before') ?? '', 10)
  const after = parseInt(c.req.query('after') ?? '', 10)
  return {
    app: c.req.query('app') || undefined,
    env: c.req.query('env') || undefined,
    service: c.req.query('service') || undefined,
    levels: levelsOf(c),
    q: c.req.query('q') || undefined,
    reqId: c.req.query('reqId') || undefined,
    before: Number.isFinite(before) ? before : undefined,
    after: Number.isFinite(after) ? after : undefined,
    limit: parseInt(c.req.query('limit') ?? '', 10) || 100,
  }
}

// Newest first; page with ?before=<nextBefore>, catch up with ?after=<newest id held>
router.get('/', async (c) => c.json(await listEvents(filterOf(c))))

// New events as they arrive, filtered by ?app= and ?levels=
router.get('/stream', (c) => {
  const { app, env, service, levels } = filterOf(c)
  c.header('X-Accel-Buffering', 'no') // Disable nginx buffering
  return streamSSE(c, async (stream) => {
    const unsubscribe = subscribeEvents({ app, env, service, levels }, (event) => {
      stream.writeSSE({ data: JSON.stringify(event) })
    })
    await holdOpen(stream, unsubscribe)
  })
})

router.get('/:id{[0-9]+}', async (c) => {
  const detail = await getEventDetail(parseInt(c.req.param('id'), 10))
  return detail ? c.json(detail) : c.json({ error: 'Event not found (it may have expired)' }, 404)
})

export default router
