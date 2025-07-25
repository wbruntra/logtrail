/**
 * Simple session-based authentication middleware
 * Checks if user has an authenticated session
 */
function requireLogin(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next()
  }
  
  // Return JSON error for API calls
  return res.status(401).json({ 
    error: 'Authentication required',
    authenticated: false,
    message: 'Please log in to access this resource'
  })
}

/**
 * Get authentication middleware (simplified)
 * @returns {Function} Express middleware function
 */
function getAuthMiddleware() {
  return requireLogin
}

module.exports = {
  requireLogin,
  getAuthMiddleware
}
