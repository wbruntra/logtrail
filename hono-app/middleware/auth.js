const { verify } = require('hono/jwt')
const { getCookie } = require('hono/cookie')
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
 * Get authentication middleware
 * @returns {Function} Hono middleware function
 */
function getAuthMiddleware() {
  return requireLogin
}

module.exports = { requireLogin, getAuthMiddleware }
