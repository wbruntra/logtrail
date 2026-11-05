import { requireLogin } from '@/hono-app/middleware/auth'
import { getDashboard, getIssue } from '@/services/dashboard'
import { Hono } from 'hono'

const router = new Hono()
router.use('*', requireLogin)

router.get('/', async (c) =>
  c.json(await getDashboard({ hours: c.req.query('hours'), levels: c.req.query('levels') })),
)

router.get('/issues/:fingerprint', async (c) => {
  const fingerprint = c.req.param('fingerprint')
  const issue = /^[0-9a-f]{16}$/.test(fingerprint) ? await getIssue(fingerprint) : null
  return issue ? c.json(issue) : c.json({ error: 'Issue not found' }, 404)
})

export default router
