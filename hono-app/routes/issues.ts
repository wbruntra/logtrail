import { requireLogin } from '@/hono-app/middleware/auth'
import { listEvents } from '@/services/event-query'
import { getIssueDetail, setIssueState } from '@/services/issues'
import { Hono } from 'hono'
import { z } from 'zod'

const router = new Hono()
router.use('*', requireLogin)

const FINGERPRINT = /^[0-9a-f]{16}$/

const stateChange = z.object({
  fingerprints: z.array(z.string().regex(FINGERPRINT)).min(1).max(500),
  state: z.enum(['open', 'resolved', 'muted']),
})

// Resolve, mute or reopen one or more issues
router.post('/state', async (c) => {
  const parsed = stateChange.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Expected { fingerprints, state }' }, 400)
  await setIssueState(parsed.data.fingerprints, parsed.data.state)
  return c.json({ ok: true })
})

router.get('/:fingerprint', async (c) => {
  const fingerprint = c.req.param('fingerprint')
  const issue = FINGERPRINT.test(fingerprint)
    ? await getIssueDetail(fingerprint, c.req.query('hours'))
    : null
  return issue ? c.json(issue) : c.json({ error: 'Issue not found' }, 404)
})

// Older occurrences, a page at a time
router.get('/:fingerprint/events', async (c) => {
  const fingerprint = c.req.param('fingerprint')
  if (!FINGERPRINT.test(fingerprint)) return c.json({ error: 'Issue not found' }, 404)
  const before = parseInt(c.req.query('before') ?? '', 10)
  return c.json(
    await listEvents({
      fingerprint,
      before: Number.isFinite(before) ? before : undefined,
      limit: parseInt(c.req.query('limit') ?? '', 10) || 25,
    }),
  )
})

export default router
