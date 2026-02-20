const { verify } = require('hono/jwt')
const secrets = require('@/secrets')

/**
 * JWT-based authentication middleware.
 * Expects an Authorization: Bearer <token> header.
 * Token payload must contain authenticated: true.
 */
async function requireLogin(c, next) {
  const authHeader = c.req.header('Authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      const payload = await verify(token, secrets.cookieSecret)
      if (payload.authenticated) {
        return next()
      }
    } catch {}
  }

  return c.json({
    error: 'Authentication required',
    authenticated: false,
    message: 'Please log in to access this resource',
  }, 401)
}

/**
 * Get authentication middleware
 * @returns {Function} Hono middleware function
 */
function getAuthMiddleware() {
  return requireLogin
}

module.exports = { requireLogin, getAuthMiddleware }
