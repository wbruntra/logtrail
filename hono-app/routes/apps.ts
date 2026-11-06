import { requireLogin } from '@/hono-app/middleware/auth'
import { getAppDetail, getOverview } from '@/services/app-health'
import { type Scope } from '@/services/scope'
import { type Context, Hono } from 'hono'

/** ?env=production&service=tpp-auth */
export function scopeOf(c: Context): Scope {
  return { env: c.req.query('env') || undefined, service: c.req.query('service') || undefined }
}

const router = new Hono()
router.use('*', requireLogin)

// Every app's error and warning counts over the window
router.get('/', async (c) =>
  c.json(await getOverview(c.req.query('hours'), new Date(), scopeOf(c))),
)

router.get('/:app', async (c) => {
  const detail = await getAppDetail(
    c.req.param('app'),
    c.req.query('hours'),
    new Date(),
    scopeOf(c),
  )
  return detail ? c.json(detail) : c.json({ error: 'App not found' }, 404)
})

export default router
