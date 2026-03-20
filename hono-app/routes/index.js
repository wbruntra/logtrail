const { Hono } = require('hono')
const { sign, verify } = require('hono/jwt')
const { setCookie, getCookie, deleteCookie } = require('hono/cookie')
const secrets = require('@/secrets')

const router = new Hono()

router.get('/health', (c) => {
  return c.json({ status: 'OK' })
})

router.get('/status', async (c) => {
  let token = null
  const authHeader = c.req.header('Authorization')

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else {
    token = getCookie(c, 'logtrail-token')
  }

  if (token) {
    try {
      const payload = await verify(token, secrets.cookieSecret, 'HS256')
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
    const token = await sign({ authenticated: true }, secrets.cookieSecret, 'HS256')
    setCookie(c, 'logtrail-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      path: '/',
      maxAge: 86400 * 7, // 7 days
    })
    return c.json({ message: 'Login successful', authenticated: true, token })
  }
  return c.json({ error: 'Invalid password', authenticated: false }, 401)
})

// Logout endpoint - JWT is stateless; client discards the token
router.get('/logout', (c) => {
  deleteCookie(c, 'logtrail-token', { path: '/' })
  return c.json({ message: 'Logged out successfully', authenticated: false })
})

module.exports = router
