import { db } from '@database/db'
import ingestRouter from '@/hono-app/routes/ingest'
import secrets from '@/secrets'
import { createLogtrail, type LogtrailOptions } from '@/sdk/logtrail'
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import express from 'express'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'

interface Sent {
  app: string
  events: Record<string, any>[]
}

/** Captures batches, and optionally forwards them to the real ingest route. */
function client(overrides: Partial<LogtrailOptions> = {}, { forward = false } = {}) {
  const sent: Sent[] = []
  const fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string))
    return forward ? ingestRouter.request('/', init) : new Response('{"ok":true}')
  }) as unknown as typeof globalThis.fetch
  const logtrail = createLogtrail({
    url: 'http://logtrail.test/',
    secret: secrets.agentSecret,
    app: 'sdk-test',
    release: 'v1',
    fetch,
    ...overrides,
  })
  const events = () => sent.flatMap((b) => b.events)
  return { logtrail, sent, events }
}

beforeEach(async () => {
  await db.deleteFrom('events').execute()
})

describe('hono()', () => {
  function honoApp(logtrail: ReturnType<typeof createLogtrail>) {
    const app = new Hono()
    app.use('*', logtrail.hono())
    app.get('/ok', (c) => {
      logtrail.log('info', 'inside handler', { amount: 5 })
      return c.text('ok')
    })
    app.get('/orders/:id', () => {
      throw Object.assign(new Error('Order lookup failed'), { code: 'DB_DOWN' })
    })
    app.get('/forbidden', () => {
      throw new HTTPException(403, { message: 'nope' })
    })
    const sub = new Hono()
    sub.get('/users/:id', (c) => c.json({ error: 'gone' }, 410))
    app.route('/api', sub)
    return app
  }

  it('reports a thrown error once, with route, code and stack', async () => {
    const { logtrail, events } = client()
    const res = await honoApp(logtrail).request('/orders/7')
    expect(res.status).toBe(500)
    await logtrail.flush()

    expect(events()).toHaveLength(1)
    const [e] = events()
    expect(e).toMatchObject({
      level: 'error',
      msg: 'Order lookup failed',
      code: 'DB_DOWN',
      method: 'GET',
      path: '/orders/7',
      route: '/orders/:id',
      status: 500,
      release: 'v1',
    })
    expect(e.stack).toContain('Order lookup failed')
    expect(e.reqId).toBe(res.headers.get('x-request-id')!)
  })

  it('reports HTTPExceptions as warnings without a stack', async () => {
    const { logtrail, events } = client()
    await honoApp(logtrail).request('/forbidden')
    await logtrail.flush()
    expect(events()[0]).toMatchObject({ level: 'warn', msg: 'nope', status: 403 })
    expect(events()[0].stack).toBeUndefined()
  })

  it('reports error responses from sub-apps with the full route', async () => {
    const { logtrail, events } = client()
    await honoApp(logtrail).request('/api/users/3')
    await honoApp(logtrail).request('/missing')
    await logtrail.flush()
    expect(events().map((e) => [e.status, e.route, e.msg])).toEqual([
      [410, '/api/users/:id', 'GET /api/users/3 410'],
      [404, undefined, 'GET /missing 404'],
    ])
  })

  it('attaches reqId to log() calls and reuses an incoming request id', async () => {
    const { logtrail, events } = client()
    const res = await honoApp(logtrail).request('/ok', { headers: { 'x-request-id': 'abc-123' } })
    await logtrail.flush()
    expect(res.headers.get('x-request-id')).toBe('abc-123')
    expect(events()).toEqual([
      expect.objectContaining({
        level: 'info',
        msg: 'inside handler',
        amount: 5,
        reqId: 'abc-123',
      }),
    ])
  })

  it('records successful requests as debug events with logRequests', async () => {
    const { logtrail, events } = client({ logRequests: true })
    await honoApp(logtrail).request('/ok')
    await logtrail.flush()
    const request = events().find((e) => e.method === 'GET')
    expect(request).toMatchObject({ level: 'debug', msg: 'GET /ok 200', status: 200, route: '/ok' })
    expect(typeof request?.duration).toBe('number')

    const quiet = client()
    await honoApp(quiet.logtrail).request('/ok')
    await quiet.logtrail.flush()
    expect(quiet.events().filter((e) => e.method === 'GET')).toEqual([])
  })

  it('honours skip()', async () => {
    const { logtrail, events } = client({ skip: (r) => r.status === 404 })
    await honoApp(logtrail).request('/missing')
    await logtrail.flush()
    expect(events()).toHaveLength(0)
  })

  it('lands in the database through the real ingest route', async () => {
    const { logtrail } = client({}, { forward: true })
    await honoApp(logtrail).request('/orders/7')
    await logtrail.flush()
    const row = await db.selectFrom('events').selectAll().executeTakeFirstOrThrow()
    expect(row).toMatchObject({ app: 'sdk-test', route: '/orders/:id', code: 'DB_DOWN' })
    expect(row.fingerprint).toHaveLength(16)
  })
})

describe('express()', () => {
  const { logtrail, events, sent } = client({ getUser: (req) => req.user?.id })
  const app = express()
  app.use((req, _res, next) => {
    ;(req as any).user = { id: 9 }
    next()
  })
  app.use(logtrail.express())
  app.get('/orders/:id', () => {
    throw new Error('Order lookup failed')
  })
  app.get('/teapot', (_req, res) => {
    logtrail.log('debug', 'brewing')
    res.status(418).send('short and stout')
  })
  app.use(logtrail.expressErrors())
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  afterAll(() => server.close())

  beforeEach(() => {
    sent.length = 0
  })

  it('reports a thrown error once, not once per middleware', async () => {
    const res = await fetch(`${base}/orders/7?x=1`)
    expect(res.status).toBe(500)
    await Bun.sleep(10) // 'finish' fires after the response is written
    await logtrail.flush()
    expect(events()).toHaveLength(1)
    expect(events()[0]).toMatchObject({
      level: 'error',
      msg: 'Order lookup failed',
      path: '/orders/7',
      route: '/orders/:id',
      status: 500,
      userId: 9,
      reqId: res.headers.get('x-request-id')!,
    })
  })

  it('reports error statuses and attaches context to log()', async () => {
    await fetch(`${base}/teapot`)
    await Bun.sleep(10)
    await logtrail.flush()
    expect(events().map((e) => [e.level, e.msg, e.userId])).toEqual([
      ['debug', 'brewing', 9],
      ['warn', 'GET /teapot 418', 9],
    ])
    expect(new Set(events().map((e) => e.reqId)).size).toBe(1)
  })
})

describe('delivery', () => {
  it('batches by size', async () => {
    const { logtrail, sent } = client({ batchSize: 2 })
    for (let i = 0; i < 5; i++) logtrail.log('info', `m${i}`)
    await logtrail.flush()
    expect(sent.map((b) => b.events.length)).toEqual([2, 2, 1])
  })

  it('retries after a network failure and keeps order', async () => {
    let calls = 0
    const received: string[] = []
    const fetch = (async (_url: string, init: RequestInit) => {
      if (calls++ === 0) throw new Error('ECONNREFUSED')
      received.push(...JSON.parse(init.body as string).events.map((e: any) => e.msg))
      return new Response('{}')
    }) as unknown as typeof globalThis.fetch
    const { logtrail } = client({ fetch })
    logtrail.log('info', 'first')
    await logtrail.flush()
    logtrail.log('info', 'second')
    await logtrail.flush()
    expect(received).toEqual(['first', 'second'])
  })

  it('drops batches the server rejects instead of retrying forever', async () => {
    let calls = 0
    const fetch = (async () => {
      calls++
      return new Response('Unauthorized', { status: 401 })
    }) as unknown as typeof globalThis.fetch
    const { logtrail } = client({ fetch })
    logtrail.log('info', 'x')
    await logtrail.flush()
    await logtrail.flush()
    expect(calls).toBe(1)
  })

  it('drops the oldest events when the queue is full', async () => {
    const { logtrail, events } = client({ maxQueue: 3, batchSize: 100 })
    for (let i = 0; i < 5; i++) logtrail.log('info', `m${i}`)
    await logtrail.flush()
    expect(events().map((e) => e.msg)).toEqual(['m2', 'm3', 'm4'])
  })

  it('does nothing when disabled', async () => {
    const { logtrail, sent } = client({ enabled: false })
    logtrail.error(new Error('x'))
    await logtrail.flush()
    expect(sent).toHaveLength(0)
  })
})

describe('captureConsole()', () => {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const
  const real = Object.fromEntries(methods.map((m) => [m, console[m]]))
  let printed: unknown[][]

  // Stand-ins for the real console, so captured calls still "print" but stay out of test output
  beforeEach(() => {
    printed = []
    for (const m of methods) console[m] = (...args: unknown[]) => void printed.push(args)
  })
  afterAll(() => Object.assign(console, real))

  it('still prints, and sends each call with its level', async () => {
    const { logtrail, events } = client()
    const restore = logtrail.captureConsole()
    console.log('processed %d tasks', 3)
    console.warn('slow', { ms: 900 })
    console.debug('detail')
    restore()
    console.log('after restore')
    await logtrail.flush()

    expect(printed).toHaveLength(4)
    expect(events().map((e) => [e.level, e.msg, e.source])).toEqual([
      ['info', 'processed 3 tasks', 'console'],
      ['warn', 'slow { ms: 900 }', 'console'],
      ['debug', 'detail', 'console'],
    ])
  })

  it('drops a leading timestamp argument and keeps an error stack', async () => {
    const { logtrail, events } = client()
    const restore = logtrail.captureConsole()
    console.info('2026-11-05T08:20:32.969Z', 'run done')
    console.error('Task failed:', new TypeError('bad token'))
    restore()
    await logtrail.flush()

    const [info, error] = events()
    expect(info.msg).toBe('run done')
    expect(error).toMatchObject({ level: 'error', msg: 'Task failed: TypeError: bad token' })
    expect(error.stack).toContain('TypeError: bad token')
  })

  it('attaches the request id inside a request', async () => {
    const { logtrail, events } = client()
    const restore = logtrail.captureConsole()
    const app = new Hono()
    app.use('*', logtrail.hono())
    app.get('/team', (c) => {
      console.log('TEAM ID', 35)
      return c.text('ok')
    })
    const res = await app.request('/team')
    restore()
    await logtrail.flush()

    expect(events()).toMatchObject([{ msg: 'TEAM ID 35', reqId: res.headers.get('x-request-id')! }])
  })

  it('lets only one client capture, and does not send its own warnings', async () => {
    const first = client()
    const second = client({ app: 'other' })
    const restore = first.logtrail.captureConsole()
    second.logtrail.captureConsole()
    console.log('once')
    restore()
    await first.logtrail.flush()
    await second.logtrail.flush()

    expect(first.events().map((e) => e.msg)).toEqual(['once'])
    expect(second.events()).toHaveLength(0)
    expect(printed.flat().join(' ')).toContain('[logtrail] console is already captured')
  })
})
