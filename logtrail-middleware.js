/**
 * logtrail-middleware.js
 *
 * Drop this file into your Express app's middleware directory.
 *
 * Usage:
 *   const logtrail = require('./middleware/logtrail-middleware')({
 *     url:    process.env.LOGTRAIL_URL,
 *     secret: process.env.LOGTRAIL_SECRET,
 *     app:    'my-api',
 *   })
 *
 *   app.use(logtrail.requests)          // optional: log 4xx/5xx responses
 *   app.use(logtrail.errors)            // log errors that reach Express error handler
 *   logtrail.attachProcessHandlers()   // optional: catch unhandled rejections/exceptions
 */

module.exports = function createLogtrail({ url, secret, app: appName }) {
  if (!url || !secret || !appName) {
    throw new Error('[logtrail] url, secret, and app are required')
  }

  // ------------------------------------------------------------------ //
  // Internal send — fire-and-forget, never throws, never blocks
  // ------------------------------------------------------------------ //

  function send(level, message) {
    const msg = `[${level}] ${message}`
    fetch(`${url}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ app: appName, msg }),
    }).catch(() => {})
  }

  // ------------------------------------------------------------------ //
  // Request logger — logs completed responses that are 4xx or 5xx
  // ------------------------------------------------------------------ //

  function requests(req, res, next) {
    res.on('finish', () => {
      const status = res.statusCode
      if (status < 400) return
      const level = status >= 500 ? 'ERROR' : 'WARN'
      send(level, `${status} ${req.method} ${req.path}`)
    })
    next()
  }

  // ------------------------------------------------------------------ //
  // Error logger — use as Express error handler (4-arg middleware)
  // Logs the error then passes it to the next error handler unchanged.
  // ------------------------------------------------------------------ //

  function errors(err, req, res, next) {
    const status = err.status || err.statusCode || 500
    const level = status >= 500 ? 'ERROR' : 'WARN'
    send(level, `${status} ${req.method} ${req.path} - ${err.message}`)
    next(err)
  }

  // ------------------------------------------------------------------ //
  // Process-level handlers — call once at startup to catch anything
  // that bypasses Express error handling entirely
  // ------------------------------------------------------------------ //

  function attachProcessHandlers() {
    process.on('unhandledRejection', (reason) => {
      const message = reason instanceof Error ? reason.message : String(reason)
      send('ERROR', `Unhandled rejection - ${message}`)
    })

    process.on('uncaughtException', (err) => {
      send('ERROR', `Uncaught exception - ${err.message}`)
    })
  }

  return { send, requests, errors, attachProcessHandlers }
}
