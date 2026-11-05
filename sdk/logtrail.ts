/**
 * logtrail.ts — drop-in client that sends structured errors and logs to logtrail.
 *
 * Copy this file into your project. It has no dependencies and runs on Bun,
 * Node 22.18+ (native type stripping) and Workers with nodejs_compat.
 *
 *   import { createLogtrail } from './logtrail'
 *   const logtrail = createLogtrail({ url, secret, app: 'my-api', release: GIT_SHA })
 *
 * Hono — one middleware, registered before your routes:
 *   app.use('*', logtrail.hono())
 *
 * Express — one before your routes, one after them (before your own error handler):
 *   app.use(logtrail.express())
 *   ...routes...
 *   app.use(logtrail.expressErrors())
 *
 * Every 4xx/5xx response becomes one event, with the thrown error's message,
 * code and stack when there is one. Inside a request, reqId and userId are
 * attached automatically:
 *   logtrail.log('info', 'Payment processed', { amount })
 *   logtrail.error(err, { orderId })
 *
 * Crashes (logs, flushes, then exits with code 1 as Node would):
 *   logtrail.captureProcessErrors()
 *
 * Console output — console.log/info/warn/error/debug still print as before, and
 * each call is also sent as an event (source: 'console'), with the request's
 * reqId when inside one:
 *   logtrail.captureConsole()
 *
 * Events are batched and sent in the background. Sending never throws and
 * never blocks the request; if logtrail is unreachable, events are retried
 * until the queue fills, then the oldest are dropped.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { format } from 'node:util'

export type Level = 'error' | 'warn' | 'info' | 'debug' | 'success'

export interface LogtrailEvent {
  ts: string
  level: Level
  msg: string
  code?: string
  reqId?: string
  userId?: string | number
  method?: string
  path?: string
  route?: string
  status?: number
  duration?: number
  release?: string
  stack?: string
  [field: string]: unknown
}

export interface RequestInfo {
  method: string
  path: string
  route?: string
  status: number
  error?: unknown
}

export interface LogtrailOptions {
  /** Base URL of logtrail, e.g. https://logs.example.com */
  url: string
  /** The agent secret configured on logtrail */
  secret: string
  /** Name this app appears under in logtrail */
  app: string
  /** Version or commit of the running code */
  release?: string
  /** Current user's id. Receives the Hono Context or the Express request. */
  getUser?: (ctx: any) => string | number | null | undefined
  /** Return true to skip a request, e.g. health checks or bot 404s. */
  skip?: (info: RequestInfo) => boolean
  /** Events per request to logtrail (default 50) */
  batchSize?: number
  /** Max wait before sending a partial batch (default 2000) */
  flushIntervalMs?: number
  /** Max events held while logtrail is unreachable (default 1000) */
  maxQueue?: number
  /** Set false to turn the client into a no-op, e.g. in tests */
  enabled?: boolean
  fetch?: typeof fetch
}

// Structural types so this file needs neither hono nor express installed.
interface HonoContextLike {
  req: {
    method: string
    path: string
    routePath?: string
    header(name: string): string | undefined
  }
  res: { status: number }
  error?: unknown
  set(key: string, value: unknown): void
  header(name: string, value: string): void
}
interface ExpressRequestLike {
  method: string
  originalUrl: string
  baseUrl?: string
  route?: { path?: unknown }
  headers: Record<string, string | string[] | undefined>
}
interface ExpressResponseLike {
  statusCode: number
  locals: Record<string, unknown>
  setHeader(name: string, value: string): unknown
  once(event: 'finish', listener: () => void): unknown
}

type NewEvent = Omit<LogtrailEvent, 'ts'>
type Outcome = 'sent' | 'retry' | 'drop'

interface Scope {
  reqId: string
  ctx: unknown
}

const REQ_ID_HEADER = 'x-request-id'
const ERROR_KEY = '__logtrailError'
const MAX_MSG = 4000
const MAX_STACK = 16000
const SEND_TIMEOUT_MS = 5000
const EXIT_FLUSH_MS = 2000

const CONSOLE_LEVELS = {
  error: 'error',
  warn: 'warn',
  info: 'info',
  log: 'info',
  debug: 'debug',
} as const satisfies Record<string, Level>
type ConsoleMethod = keyof typeof CONSOLE_LEVELS
type ConsoleFn = (...args: unknown[]) => void
// The real console methods while captured, shared by every copy of this file so
// only one client captures, and so the client's own output is not sent
const CAPTURED = Symbol.for('logtrail.console')
type CapturableConsole = Record<ConsoleMethod, ConsoleFn> & {
  [CAPTURED]?: Partial<Record<ConsoleMethod, ConsoleFn>>
}
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/

/** console[method] as it was before captureConsole, so internal output is not captured. */
function rawConsole(method: ConsoleMethod): ConsoleFn {
  const target = console as unknown as CapturableConsole
  return (target[CAPTURED]?.[method] ?? target[method]).bind(console)
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s)

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | undefined)?.code
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined
}

function randomId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Reuse an upstream request id (proxy, gateway) when it looks sane. */
function pickReqId(incoming: string | string[] | undefined): string {
  const value = Array.isArray(incoming) ? incoming[0] : incoming
  return value && /^[\w.-]{1,64}$/.test(value) ? value : randomId()
}

function defaultGetUser(ctx: any): string | number | undefined {
  // Hono: c.get('user') / c.get('userId'); Express: req.user
  if (ctx && typeof ctx.get === 'function' && ctx.req) {
    return ctx.get('user')?.id ?? ctx.get('userId')
  }
  return ctx?.user?.id
}

function honoRoute(c: HonoContextLike): string | undefined {
  // After next(), routePath is the pattern of the last handler that ran. If that
  // was a wildcard middleware, no route matched (404).
  const route = c.req.routePath
  return route && route !== '*' && !route.endsWith('/*') ? route : undefined
}

function expressRoute(req: ExpressRequestLike): string | undefined {
  // Routers restore baseUrl on the way out, so nested routers may report only
  // their own part of the pattern.
  const route = req.route?.path
  return typeof route === 'string' ? `${req.baseUrl ?? ''}${route}` : undefined
}

export function createLogtrail(options: LogtrailOptions) {
  const {
    url,
    secret,
    app,
    release,
    getUser = defaultGetUser,
    skip,
    batchSize = 50,
    flushIntervalMs = 2000,
    maxQueue = 1000,
    enabled = true,
    fetch: send = globalThis.fetch,
  } = options
  if (!url || !secret || !app) throw new Error('[logtrail] url, secret and app are required')

  const endpoint = `${url.replace(/\/+$/, '')}/api/ingest`
  const scope = new AsyncLocalStorage<Scope>()
  const warned = new Set<string>()
  let queue: LogtrailEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let sending: Promise<void> = Promise.resolve()

  function warnOnce(key: string, message: string): void {
    if (warned.has(key)) return
    warned.add(key)
    rawConsole('warn')(`[logtrail] ${message}`)
  }

  function userOf(ctx: unknown): string | number | undefined {
    try {
      return getUser(ctx) ?? undefined
    } catch {
      return undefined
    }
  }

  function enqueue(event: NewEvent, s: Scope | undefined = scope.getStore()): void {
    if (!enabled) return
    const full: Record<string, unknown> = {
      ts: new Date().toISOString(),
      release,
      reqId: s?.reqId,
      userId: s ? userOf(s.ctx) : undefined,
    }
    for (const [k, v] of Object.entries(event)) if (v !== undefined) full[k] = v
    for (const k of Object.keys(full)) if (full[k] == null) delete full[k]

    queue.push(full as LogtrailEvent)
    if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue)
    if (queue.length >= batchSize) void flush()
    else schedule()
  }

  function schedule(): void {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      void flush()
    }, flushIntervalMs)
    ;(timer as { unref?: () => void }).unref?.()
  }

  async function post(events: LogtrailEvent[]): Promise<Outcome> {
    try {
      const res = await send(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ app, events }),
        signal: AbortSignal.timeout?.(SEND_TIMEOUT_MS),
      })
      const body = await res.text().catch(() => '')
      if (res.ok) return 'sent'
      if (res.status >= 500 || res.status === 429) {
        warnOnce(`http-${res.status}`, `logtrail responded ${res.status}; will retry`)
        return 'retry'
      }
      // 4xx won't succeed on retry: wrong secret, or events the server rejects.
      warnOnce(`http-${res.status}`, `logtrail rejected a batch (HTTP ${res.status}): ${body}`)
      return 'drop'
    } catch (err) {
      warnOnce('network', `could not reach ${endpoint}: ${toError(err).message}; will retry`)
      return 'retry'
    }
  }

  async function drain(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    while (queue.length) {
      const batch = queue.splice(0, batchSize)
      if ((await post(batch)) === 'retry') {
        queue = batch.concat(queue).slice(-maxQueue)
        schedule()
        return
      }
    }
  }

  /** Send everything queued now. Resolves when done; never rejects. */
  function flush(): Promise<void> {
    sending = sending.then(drain, drain)
    return sending
  }

  function requestEvent(info: RequestInfo, duration: number): NewEvent | undefined {
    const { method, path, route, status, error } = info
    if (error === undefined && status < 400) return
    if (skip?.(info)) return
    const err = error === undefined ? undefined : toError(error)
    const level: Level = status >= 500 || (err && status < 400) ? 'error' : 'warn'
    return {
      level,
      msg: err ? clip(err.message || err.name, MAX_MSG) : `${method} ${path} ${status}`,
      code: errorCode(error),
      method,
      path,
      route,
      status,
      duration,
      stack: level === 'error' && err?.stack ? clip(err.stack, MAX_STACK) : undefined,
    }
  }

  function hono() {
    return async (c: HonoContextLike, next: () => Promise<void>): Promise<void> => {
      const start = Date.now()
      const s: Scope = { reqId: pickReqId(c.req.header(REQ_ID_HEADER)), ctx: c }
      c.set('reqId', s.reqId)
      await scope.run(s, next)
      c.header(REQ_ID_HEADER, s.reqId)
      const info = {
        method: c.req.method,
        path: c.req.path,
        route: honoRoute(c),
        status: c.res.status,
        error: c.error,
      }
      const event = requestEvent(info, Date.now() - start)
      if (event) enqueue(event, s)
    }
  }

  function express() {
    return (req: ExpressRequestLike, res: ExpressResponseLike, next: () => void): void => {
      const start = Date.now()
      const s: Scope = { reqId: pickReqId(req.headers[REQ_ID_HEADER]), ctx: req }
      res.locals.reqId = s.reqId
      res.setHeader(REQ_ID_HEADER, s.reqId)
      res.once('finish', () => {
        const info = {
          method: req.method,
          path: req.originalUrl.split('?')[0],
          route: expressRoute(req),
          status: res.statusCode,
          error: res.locals[ERROR_KEY],
        }
        const event = requestEvent(info, Date.now() - start)
        if (event) enqueue(event, s)
      })
      scope.run(s, next)
    }
  }

  /** Records the error for express() to report, then passes it on unchanged. */
  function expressErrors() {
    return (
      err: unknown,
      _req: ExpressRequestLike,
      res: ExpressResponseLike,
      next: (err: unknown) => void,
    ): void => {
      res.locals[ERROR_KEY] = err
      next(err)
    }
  }

  function log(level: Level, msg: string, meta: Record<string, unknown> = {}): void {
    enqueue({ ...meta, level, msg: clip(String(msg), MAX_MSG) })
  }

  function errorEvent(err: unknown, label?: string): NewEvent {
    const e = toError(err)
    const message = e.message || e.name
    return {
      level: 'error',
      msg: clip(label ? `${label}: ${message}` : message, MAX_MSG),
      code: errorCode(err),
      stack: e.stack ? clip(e.stack, MAX_STACK) : undefined,
    }
  }

  function error(err: unknown, meta: Record<string, unknown> = {}): void {
    enqueue({ ...meta, ...errorEvent(err) })
  }

  const proc = (globalThis as { process?: any }).process
  // Send whatever is left when the process winds down naturally.
  proc?.once?.('beforeExit', () => void flush())

  /**
   * Report uncaught exceptions and unhandled rejections. By default the process
   * then exits with code 1, as it would without a handler. Pass { exit: false }
   * to keep it running.
   */
  function captureProcessErrors({ exit = true }: { exit?: boolean } = {}): void {
    if (!proc?.on) return
    const handler = (label: string) => (reason: unknown) => {
      enqueue(errorEvent(reason, label))
      if (!exit) return void flush()
      rawConsole('error')(reason)
      const timeout = new Promise((resolve) => setTimeout(resolve, EXIT_FLUSH_MS))
      void Promise.race([flush(), timeout]).then(() => proc.exit(1))
    }
    proc.on('uncaughtException', handler('Uncaught exception'))
    proc.on('unhandledRejection', handler('Unhandled rejection'))
  }

  /**
   * Also send console output as events: error and warn keep their level, debug
   * is debug, log and info are info. Errors among the arguments contribute their
   * message, and the first one's stack goes in `stack`. A leading ISO timestamp
   * argument is dropped, since events carry their own. Only one client per
   * process captures; returns a function that restores the console.
   */
  function captureConsole(): () => void {
    const target = console as unknown as CapturableConsole
    if (!enabled) return () => {}
    if (target[CAPTURED]) {
      warnOnce('console', 'console is already captured by another client')
      return () => {}
    }
    const originals: Partial<Record<ConsoleMethod, ConsoleFn>> = {}
    target[CAPTURED] = originals
    let inside = false // console use while building an event, e.g. a getter that logs

    for (const method of Object.keys(CONSOLE_LEVELS) as ConsoleMethod[]) {
      const original = target[method]
      originals[method] = original
      target[method] = (...args: unknown[]) => {
        original.apply(console, args)
        if (inside) return
        inside = true
        try {
          const parts =
            args.length > 1 && typeof args[0] === 'string' && ISO_TS.test(args[0])
              ? args.slice(1)
              : args
          const err = parts.find((a): a is Error => a instanceof Error)
          const text = parts.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : a))
          enqueue({
            level: CONSOLE_LEVELS[method],
            msg: clip(format(...text), MAX_MSG),
            source: 'console',
            stack: err?.stack ? clip(err.stack, MAX_STACK) : undefined,
          })
        } catch {
          // never let logging break the caller
        } finally {
          inside = false
        }
      }
    }

    return () => {
      if (target[CAPTURED] !== originals) return
      for (const method of Object.keys(originals) as ConsoleMethod[]) {
        target[method] = originals[method]!
      }
      delete target[CAPTURED]
    }
  }

  return {
    hono,
    express,
    expressErrors,
    log,
    error,
    flush,
    captureProcessErrors,
    captureConsole,
  }
}

export type Logtrail = ReturnType<typeof createLogtrail>
