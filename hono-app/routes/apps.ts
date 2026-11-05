import { requireLogin } from '@/hono-app/middleware/auth'
import { getAppDetail, getOverview } from '@/services/app-health'
import { Hono } from 'hono'

const router = new Hono()
router.use('*', requireLogin)

// Every app's error and warning counts over the window
router.get('/', async (c) => c.json(await getOverview(c.req.query('hours'))))

router.get('/:app', async (c) => {
  const detail = await getAppDetail(c.req.param('app'), c.req.query('hours'))
  return detail ? c.json(detail) : c.json({ error: 'App not found' }, 404)
})

export default router
