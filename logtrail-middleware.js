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
 *   app.use(logtrail.reqId)              // attach reqId to res.locals (put this first)
 *   app.use(logtrail.requests)           // log 4xx/5xx responses with timing
 *   app.use(logtrail.errors)             // log errors that reach Express error handler
 *   logtrail.attachProcessHandlers()     // catch unhandled rejections/exceptions
 *
 *   // Manual logging from route handlers:
 *   logtrail.log('info', 'User signed up', { userId: 42, reqId: res.locals.reqId })
 */

const { randomBytes } = require('crypto')

module.exports = function createLogtrail({ url, secret, app: appName }) {
  if (!url || !secret || !appName) {
    throw new Error('[logtrail] url, secret, and app are required')
  }

  // ------------------------------------------------------------------ //
  // Internal send — fire-and-forget, never throws, never blocks
  // Sends a structured event object. All fields except app/level/msg are optional.
  // ------------------------------------------------------------------ //

  function send(event) {
    // Strip undefined fields so the payload stays clean
    const payload = { app: appName }
    for (const [k, v] of Object.entries(event)) {
      if (v !== undefined && v !== null) payload[k] = v
    }

    fetch(`${url}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }

  // ------------------------------------------------------------------ //
  // Public manual logger — call from route handlers for non-error events
  // logtrail.log('info', 'Payment processed', { userId: 42, reqId: res.locals.reqId })
  // ------------------------------------------------------------------ //

  function log(level, msg, meta = {}) {
    send({ level, msg, ...meta })
  }

  // ------------------------------------------------------------------ //
  // reqId middleware — generates a short request ID and attaches it to
  // res.locals so downstream middleware and route handlers can use it.
  // Put this before logtrail.requests.
  // ------------------------------------------------------------------ //

  function reqId(req, res, next) {
    res.locals.reqId = randomBytes(4).toString('hex')
    next()
  }

  // ------------------------------------------------------------------ //
  // Request logger — logs completed 4xx/5xx responses with timing.
  // ------------------------------------------------------------------ //

  function requests(req, res, next) {
    const startTime = Date.now()
    res.on('finish', () => {
      const status = res.statusCode
      if (status < 400) return
      send({
        level: status >= 500 ? 'error' : 'warn',
        msg: `${req.method} ${req.path} ${status}`,
        method: req.method,
        path: req.path,
        status,
        duration: Date.now() - startTime,
        reqId: res.locals?.reqId,
        userId: req.user?.id,
      })
    })
    next()
  }

  // ------------------------------------------------------------------ //
  // Error logger — use as Express error handler (4-arg middleware).
  // Logs the error then passes it to the next error handler unchanged.
  // ------------------------------------------------------------------ //

  function errors(err, req, res, next) {
    const status = err.status || err.statusCode || 500
    send({
      level: status >= 500 ? 'error' : 'warn',
      code: err.code,
      msg: `${req.method} ${req.path} ${status} - ${err.message}`,
      method: req.method,
      path: req.path,
      status,
      reqId: res.locals?.reqId,
      userId: req.user?.id,
      // Only include stack for server errors — client errors (4xx) don't need it
      stack: status >= 500 ? err.stack : undefined,
    })
    next(err)
  }

  // ------------------------------------------------------------------ //
  // Process-level handlers — catch anything that bypasses Express
  // error handling entirely (unhandled promise rejections, etc.)
  // ------------------------------------------------------------------ //

  function attachProcessHandlers() {
    process.on('unhandledRejection', (reason) => {
      const msg = reason instanceof Error ? reason.message : String(reason)
      const stack = reason instanceof Error ? reason.stack : undefined
      send({ level: 'error', msg: `Unhandled rejection - ${msg}`, stack })
    })

    process.on('uncaughtException', (err) => {
      send({ level: 'error', msg: `Uncaught exception - ${err.message}`, stack: err.stack })
    })
  }

  return { send, log, reqId, requests, errors, attachProcessHandlers }
}
