const { Hono } = require('hono')
const { getDashboard } = require('@/services/dashboard')
const { getAuthMiddleware } = require('@/hono-app/middleware/auth')

const router = new Hono()
router.use('*', getAuthMiddleware())

router.get('/', (c) =>
  c.json(getDashboard({ hours: c.req.query('hours'), levels: c.req.query('levels') })),
)

module.exports = router
