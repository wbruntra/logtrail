const { verify } = require('hono/jwt')
const { getCookie } = require('hono/cookie')
const { timingSafeEqual } = require('crypto')
const secrets = require('@/secrets')

/**
 * JWT-based authentication middleware.
 * Expects an Authorization: Bearer <token> header or a cookie.
 * Token payload must contain authenticated: true.
 */
async function requireLogin(c, next) {
  let token = null
  const authHeader = c.req.header('Authorization')

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  } else if (getCookie(c, 'logtrail-token')) {
    token = getCookie(c, 'logtrail-token')
  }

  if (token) {
    try {
      const payload = await verify(token, secrets.cookieSecret, 'HS256')
      if (payload.authenticated) {
        return next()
      }
    } catch (err) {
      return c.json(
        {
          error: 'JWT Verification failed',
          details: err.message,
          authenticated: false,
        },
        401,
      )
    }
  }

  return c.json(
    {
      error: 'Authentication required',
      authenticated: false,
      message: 'Please log in to access this resource',
    },
    401,
  )
}

/**
 * Static bearer-token authentication for the MCP endpoint.
 * Only secrets.mcpToken is accepted; web login tokens are not.
 */
async function requireMcpToken(c, next) {
  const authHeader = c.req.header('Authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const expected = secrets.mcpToken

  if (expected && token) {
    const a = Buffer.from(token)
    const b = Buffer.from(expected)
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return next()
    }
  }

  return c.json({ error: 'Invalid or missing MCP token' }, 401)
}

/**
 * Get authentication middleware
 * @returns {Function} Hono middleware function
 */
function getAuthMiddleware() {
  return requireLogin
}

module.exports = { requireLogin, requireMcpToken, getAuthMiddleware }
