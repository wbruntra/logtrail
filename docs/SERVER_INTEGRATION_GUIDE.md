# Logtrail — Server Integration Guide (Hono / Express)

This guide shows how to report errors from a Hono or Express server to Logtrail using the drop-in client, `logtrail.ts`. It covers setup for both frameworks, what is reported automatically, manual logging, and how events are grouped into issues.

---

## Overview

`logtrail.ts` is a single file with no dependencies. You copy it into your project, create a client with your credentials, and mount its middleware. From then on, every failed request (status 4xx or 5xx, or a thrown error) is sent to Logtrail as one structured event, with the error message, code, stack trace, route and request ID.

In Logtrail, events appear in the log viewer under your app's name, and errors and warnings are grouped into **issues** on the dashboard: one row per distinct problem, with a count, the number of affected users, and when it was first and last seen.

Events are kept for 3 days by default.

The client runs on Bun, Node 22.18+ and Cloudflare Workers (with `nodejs_compat`). Sending happens in the background: it never throws, and never delays your responses.

---

## Setup

### 1. Download the client

Logtrail serves the current version of the file:

```bash
# TypeScript source: Bun, Node 22.18+, or any TypeScript project
curl -o src/logtrail.ts https://<logtrail-host>/api/client/logtrail.ts

# Or built JavaScript, for projects without TypeScript
curl -o src/logtrail.js  https://<logtrail-host>/api/client/logtrail.js    # ES modules
curl -o src/logtrail.cjs https://<logtrail-host>/api/client/logtrail.cjs   # require()
```

Re-run the command to update. The usage notes at the top of the file match this guide.

### 2. Set environment variables

```
LOGTRAIL_URL=https://<logtrail-host>
LOGTRAIL_SECRET=<agent-secret>
```

Ask the Logtrail administrator for the host and the secret. The secret authenticates your server to the ingest endpoint; it cannot be used to log in to the Logtrail UI.

### 3. Create the client

```ts
// logtrail-client.ts
import { createLogtrail } from './logtrail'

export const logtrail = createLogtrail({
  url: process.env.LOGTRAIL_URL!,
  secret: process.env.LOGTRAIL_SECRET!,
  app: 'my-api', // how this server appears in Logtrail; keep it stable, kebab-case
  release: process.env.GIT_SHA, // optional: the deployed version
})
```

Create it once and import it wherever you log. `release` is optional, but it lets you see which deploy an issue first appeared in.

### 4. Mount the middleware

#### Hono

One middleware, registered before your routes:

```ts
import { Hono } from 'hono'
import { logtrail } from './logtrail-client'

const app = new Hono()
app.use('*', logtrail.hono())

app.get('/orders/:id', async (c) => {
  // ...
})
```

Errors thrown in handlers are reported with their stack trace and then handled by Hono as usual, including your `app.onError` if you have one. `HTTPException`s are reported at their own status.

#### Express

Two middleware functions: `express()` before your routes, and `expressErrors()` after them, before your own error handler.

```ts
import express from 'express'
import { logtrail } from './logtrail-client'

const app = express()
app.use(logtrail.express())
app.use(express.json())

// ... your routes ...

app.use(logtrail.expressErrors())

// Your existing error handler
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message })
})
```

`expressErrors()` only records the error and passes it on unchanged; the event is sent once the response finishes, so each failed request produces exactly one event.

### 5. Report crashes

```ts
logtrail.captureProcessErrors()
```

Call this once at startup. Uncaught exceptions and unhandled promise rejections are reported, the queue is flushed (for up to 2 seconds), and the process exits with code 1, as it would without a handler. Pass `{ exit: false }` to report without exiting.

---

## What Gets Reported Automatically

| Situation                                | Level   | What is captured                                                   |
| ---------------------------------------- | ------- | ------------------------------------------------------------------ |
| 4xx response                             | `warn`  | Method, path, route pattern, status, duration, request ID, user ID |
| 5xx response                             | `error` | The same                                                           |
| Thrown error, 4xx                        | `warn`  | The same, plus the error message and `code`                        |
| Thrown error, 5xx                        | `error` | The same, plus the stack trace                                     |
| Uncaught exception / unhandled rejection | `error` | Message, code and stack trace (with `captureProcessErrors()`)      |

Successful responses are not reported.

### Request IDs

Each request gets an ID. If the request arrives with an `x-request-id` header (from a proxy or gateway), that value is reused; otherwise a new one is generated. The ID is returned in the `x-request-id` response header, and is available to your code as `c.get('reqId')` in Hono or `res.locals.reqId` in Express.

Every event sent while handling a request, including your own `logtrail.log()` calls, carries that ID automatically. Search for it in Logtrail to see everything one request did.

### Users

By default, the user ID is read from `c.get('user')?.id` or `c.get('userId')` in Hono, and `req.user?.id` in Express. If your auth stores the user somewhere else, pass `getUser`:

```ts
createLogtrail({
  // ...
  getUser: (c) => c.get('session')?.accountId, // Hono: receives the Context
  // getUser: (req) => req.auth?.sub,           // Express: receives the request
})
```

It is called when the event is sent, so it sees users set by auth middleware that runs after Logtrail's.

---

## Manual Logging

For events that aren't failed requests — business events, caught errors, slow operations — call the client directly. Inside a request, the request ID and user ID are added for you.

```ts
logtrail.log(level, message, fields?)
logtrail.error(err, fields?)
```

| Parameter | Type    | Description                                                 |
| --------- | ------- | ----------------------------------------------------------- |
| `level`   | string  | `error`, `warn`, `info`, `debug`, or `success`              |
| `message` | string  | Short human-readable description                            |
| `err`     | unknown | An error you caught; its message, `code` and stack are sent |
| `fields`  | object  | Any additional fields to store with the event               |

```ts
app.post('/payments', async (c) => {
  const result = await processPayment(await c.req.json())
  logtrail.log('success', 'Payment processed', {
    amount: result.amount,
    currency: result.currency,
    paymentId: result.id,
  })
  return c.json(result)
})
```

```ts
try {
  await syncInventory()
} catch (err) {
  // Handled here, so no failed request will report it
  logtrail.error(err, { warehouse: 'east' })
}
```

Fields without a dedicated meaning are stored as-is and shown in the event details.

---

## Issues and Error Codes

Errors and warnings are grouped into issues by:

- the app,
- the method and route pattern (`GET /orders/:id`, not `/orders/123`),
- the HTTP status,
- the error `code` if there is one, otherwise the message with numbers and IDs removed,
- the first stack frame in your own code (line numbers ignored, so a deploy doesn't split an issue).

So `Order 123 not found` and `Order 456 not found` on the same route are one issue. To control grouping explicitly, give your errors a `code`:

```ts
const err = new HTTPException(404, { message: `Order ${id} not found` })
throw Object.assign(err, { code: 'ORDER_NOT_FOUND' })
```

Use stable, uppercase codes. Messages change over time; codes are what you search and count by.

---

## Options

| Option            | Default   | Description                                                                                                           |
| ----------------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `url`             | required  | Logtrail base URL                                                                                                     |
| `secret`          | required  | Agent secret                                                                                                          |
| `app`             | required  | App name shown in Logtrail                                                                                            |
| `release`         | —         | Version or commit of the running code                                                                                 |
| `getUser`         | see above | Returns the current user's ID                                                                                         |
| `skip`            | —         | `(info) => boolean`; return true to not report a request. `info` has `method`, `path`, `route`, `status` and `error`. |
| `batchSize`       | 50        | Events per request to Logtrail                                                                                        |
| `flushIntervalMs` | 2000      | Longest wait before sending a partial batch                                                                           |
| `maxQueue`        | 1000      | Events held while Logtrail is unreachable                                                                             |
| `enabled`         | true      | Set `false` to make the client a no-op, e.g. in tests                                                                 |

Skipping noisy requests:

```ts
createLogtrail({
  // ...
  skip: ({ path, status }) => path === '/health' || (status === 404 && path.startsWith('/wp-')),
})
```

---

## Delivery

Events are queued and sent in batches: when 50 are waiting, or 2 seconds after the first one. If Logtrail can't be reached or answers with a 5xx, the batch is kept and retried; if the queue fills during a long outage, the oldest events are dropped. If Logtrail rejects a batch (a wrong secret, for example), it is dropped and a single warning is printed — the client never logs more than one warning per kind of failure.

Pending events are sent automatically when the process exits normally. For an explicit shutdown, flush first:

```ts
process.on('SIGTERM', async () => {
  await logtrail.flush()
  process.exit(0)
})
```

---

## Moving from logtrail-middleware.js

`logtrail-middleware.js` is replaced by `logtrail.ts`. Logtrail still accepts events from the old file, so you can switch at any time.

| Old                                                      | New                                                   |
| -------------------------------------------------------- | ----------------------------------------------------- |
| `require('./logtrail-middleware')({ url, secret, app })` | `createLogtrail({ url, secret, app })`                |
| `app.use(logtrail.reqId)` + `app.use(logtrail.requests)` | `app.use(logtrail.express())`                         |
| `app.use(logtrail.errors)`                               | `app.use(logtrail.expressErrors())`                   |
| `logtrail.attachProcessHandlers()`                       | `logtrail.captureProcessErrors()`                     |
| `logtrail.log(level, msg, { reqId: res.locals.reqId })`  | `logtrail.log(level, msg)` — `reqId` is added for you |

Differences to expect: an error that reaches the error handler is now one event rather than two; events carry the route pattern, so they group into issues; and `captureProcessErrors()` exits the process after a crash instead of keeping it running.

---

## Guidelines

**Do log:**

- Business-significant failures: payment declined, auth failure, quota exceeded
- Slow operations that indicate degradation
- Errors you catch and handle, with `logtrail.error()`
- State changes that are hard to reconstruct later (user deleted, account suspended)

**Do not log:**

- Successful routine requests (too much volume, no signal)
- Sensitive data: passwords, tokens, payment card numbers, personal information
- High-frequency health check or ping endpoints (use `skip`)
