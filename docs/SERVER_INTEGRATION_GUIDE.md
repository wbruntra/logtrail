# Logtrail — Server Integration Guide (Express / Hono)

This guide explains how to integrate Logtrail into a Node.js HTTP server using the provided middleware module. It covers setup, the available middleware functions, manual logging, and what gets reported automatically.

---

## Overview

Logtrail receives structured log events via HTTP. The middleware module (`logtrail-middleware.js`) wraps this into a familiar Express-style API. Drop the file into your project, initialise it with your credentials, and mount the middleware you need.

Events are stored for 3 days and displayed in a live log viewer with colour-coded log levels, search, and filtering.

---

## Setup

### 1. Copy the middleware file

Copy `logtrail-middleware.js` into your project's middleware directory. It has no dependencies beyond Node's built-in `crypto` module.

### 2. Set environment variables

```
LOGTRAIL_URL=https://<logtrail-host>
LOGTRAIL_SECRET=<agent-secret>
```

Ask the system administrator for the host URL and secret. The secret authenticates your server to the Logtrail ingest endpoint.

### 3. Initialise

```js
const logtrail = require('./middleware/logtrail-middleware')({
  url:    process.env.LOGTRAIL_URL,
  secret: process.env.LOGTRAIL_SECRET,
  app:    'my-api',            // stable identifier shown in Logtrail — use kebab-case
})
```

The `app` value is how your server appears in the Logtrail log selector. All events from this process will be grouped under it. Use a consistent name across deployments.

---

## Middleware Reference

### `logtrail.reqId`

Generates a short random request ID (`res.locals.reqId`) and attaches it to every request. This ID travels with every log event for that request, allowing you to trace a single request across multiple log lines in Logtrail's search.

Mount this **first**, before all other middleware.

```js
app.use(logtrail.reqId)
```

### `logtrail.requests`

Logs every completed response with status 400 or above, including the HTTP method, path, status code, and duration. Responses below 400 are not logged — only failures are reported.

- Status 4xx → logged at `warn` level
- Status 5xx → logged at `error` level

```js
app.use(logtrail.requests)
```

Mount this early in the stack, after `logtrail.reqId`, so it captures timing for all routes.

### `logtrail.errors`

A standard Express error handler (four-argument middleware). Log the error to Logtrail and then pass it unchanged to the next error handler — typically your existing one that sends the HTTP response.

```js
// Before your existing error handler
app.use(logtrail.errors)

// Your existing handler follows
app.use(function (err, req, res, next) {
  res.status(err.status || 500).json({ error: err.message })
})
```

For 5xx errors, the stack trace is included in the event. For 4xx errors (expected failures like validation or not-found), only the message is sent.

### `logtrail.attachProcessHandlers()`

Catches `unhandledRejection` and `uncaughtException` at the process level — errors that bypass Express error handling entirely. Call this once at startup.

```js
logtrail.attachProcessHandlers()
```

---

## Complete Setup Example (Express)

```js
const express = require('express')
const createError = require('http-errors')
const logtrail = require('./middleware/logtrail-middleware')({
  url:    process.env.LOGTRAIL_URL,
  secret: process.env.LOGTRAIL_SECRET,
  app:    'my-api',
})

const app = express()

// Logtrail middleware — reqId and requests go at the top
app.use(logtrail.reqId)
app.use(logtrail.requests)

app.use(express.json())

// ... your routes ...

// 404 handler
app.use((req, res, next) => next(createError(404)))

// Logtrail error handler — before your own error handler
app.use(logtrail.errors)

// Your existing error handler
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message })
})

// Catch anything that bypasses Express entirely
logtrail.attachProcessHandlers()
```

---

## Manual Logging

For events that aren't errors — business events, important state changes, slow operations — use `logtrail.log()` directly from route handlers.

```js
logtrail.log(level, message, metadata)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `level` | string | `error`, `warn`, `info`, `debug`, or `success` |
| `message` | string | Short human-readable description |
| `metadata` | object | Any additional fields to store with the event |

Always include `reqId` from `res.locals` so the event can be correlated with the request that triggered it:

```js
app.post('/api/payments', async (req, res) => {
  const result = await processPayment(req.body)

  logtrail.log('success', 'Payment processed', {
    userId:    req.user.id,
    reqId:     res.locals.reqId,
    amount:    result.amount,
    currency:  result.currency,
    paymentId: result.id,
  })

  res.json(result)
})
```

```js
app.post('/api/auth/login', async (req, res) => {
  const valid = await checkCredentials(req.body)

  if (!valid) {
    logtrail.log('warn', 'Failed login attempt', {
      reqId: res.locals.reqId,
      ip:    req.ip,
    })
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  res.json({ token: generateToken() })
})
```

---

## What Gets Logged Automatically

With the three middleware functions mounted, you get the following without any additional code:

| Situation | Level | What is captured |
|-----------|-------|-----------------|
| 4xx response | `warn` | Method, path, status, duration, reqId, userId |
| 5xx response | `error` | Method, path, status, duration, reqId, userId |
| Error reaches error handler | `error` / `warn` | All of the above plus error message, error code, and stack trace (5xx only) |
| Unhandled promise rejection | `error` | Message and stack trace |
| Uncaught exception | `error` | Message and stack trace |

---

## Error Codes

If your errors carry a `code` property (e.g. `http-errors` or custom error classes), Logtrail stores it as a distinct field and displays it alongside the message. This makes it easy to search for and count specific error types across the 3-day window.

```js
const err = new Error('Resource not found')
err.status = 404
err.code = 'RESOURCE_NOT_FOUND'
next(err)
// Logged as: { level: 'warn', code: 'RESOURCE_NOT_FOUND', msg: 'GET /api/items/99 404 - Resource not found', ... }
```

Use stable, uppercase codes. Error messages change over time; codes are what you search and count by.

---

## Hono

The middleware uses the Express convention (`(req, res, next)` and `res.locals`), so it does not work directly with Hono's context model. For a Hono app, call `logtrail.log()` and `logtrail.send()` directly from your route handlers and middleware rather than mounting the Express-style helpers.

```js
// Hono equivalent of the reqId middleware
app.use(async (c, next) => {
  c.set('reqId', randomBytes(4).toString('hex'))
  await next()
})

// Hono equivalent of the error middleware
app.onError((err, c) => {
  const status = err.status || 500
  logtrail.log(status >= 500 ? 'error' : 'warn', `${c.req.method} ${c.req.path} ${status} - ${err.message}`, {
    method:  c.req.method,
    path:    c.req.path,
    status,
    reqId:   c.get('reqId'),
    stack:   status >= 500 ? err.stack : undefined,
  })
  return c.json({ error: err.message }, status)
})
```

---

## Guidelines

**Do log:**
- Business-significant failures: payment declined, auth failure, quota exceeded
- Slow operations that indicate degradation
- Any error that reaches the error handler
- State changes that are hard to reconstruct later (user deleted, account suspended)

**Do not log:**
- Successful routine requests (too much volume, no signal)
- Sensitive data: passwords, tokens, payment card numbers, personal information
- High-frequency health check or ping endpoints (these create noise and inflate counts)
