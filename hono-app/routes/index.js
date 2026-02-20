const { Hono } = require('hono')
const { sign, verify } = require('hono/jwt')
const secrets = require('@/secrets')

const router = new Hono()

router.get('/health', (c) => {
  return c.json({ status: 'OK' })
})

router.get('/status', async (c) => {
  const authHeader = c.req.header('Authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const payload = await verify(token, secrets.cookieSecret)
      if (payload.authenticated) {
        return c.json({ status: 'Authenticated', authenticated: true })
      }
    } catch {}
  }
  return c.json({ status: 'Unauthenticated', authenticated: false })
})

// Login endpoint
router.post('/login', async (c) => {
  const { password } = await c.req.json()
  if (password === secrets.password) {
    const token = await sign({ authenticated: true }, secrets.cookieSecret)
    return c.json({ message: 'Login successful', authenticated: true, token })
  }
  return c.json({ error: 'Invalid password', authenticated: false }, 401)
})

// Logout endpoint - JWT is stateless; client discards the token
router.get('/logout', (c) => {
  return c.json({ message: 'Logged out successfully', authenticated: false })
})

module.exports = router
