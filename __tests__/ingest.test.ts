import { db } from '@database/db'
import router from '@/hono-app/routes/ingest'
import secrets from '@/secrets'
import { beforeEach, describe, expect, it } from 'bun:test'

function post(body: unknown, token = secrets.agentSecret) {
  return router.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

const rows = () => db.selectFrom('events').selectAll().orderBy('id').execute()

beforeEach(async () => {
  await db.deleteFrom('events').execute()
})

describe('POST /api/ingest', () => {
  it('rejects a wrong secret', async () => {
    const res = await post({ app: 'a', msg: 'x' }, 'wrong')
    expect(res.status).toBe(401)
  })

  it('stores a batch of structured events in typed columns', async () => {
    const ts = new Date(Date.now() - 1000).toISOString()
    const res = await post({
      app: 'shop api',
      events: [
        {
          ts,
          level: 'ERROR',
          msg: 'Order 1234 not found',
          code: 'ORDER_NOT_FOUND',
          reqId: 'r1',
          method: 'get',
          path: '/orders/1234',
          route: '/orders/:id',
          status: 500,
          duration: 12.6,
          userId: 42,
          stack: 'Error: x\n    at handler (/app/src/orders.ts:10:5)',
          tenant: 'acme',
        },
        { level: 'info', msg: 'started' },
      ],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, written: 2 })

    const [error, info] = await rows()
    expect(error).toMatchObject({
      app: 'shop-api',
      service: 'shop-api',
      env: 'production',
      ts,
      level: 'error',
      code: 'ORDER_NOT_FOUND',
      req_id: 'r1',
      method: 'GET',
      route: '/orders/:id',
      status: 500,
      duration_ms: 13,
      user_id: '42',
      extra: '{"tenant":"acme"}',
    })
    expect(error.fingerprint).toHaveLength(16)
    expect(info.fingerprint).toBeNull()
  })

  it('stores the valid events of a batch and reports the rest', async () => {
    const res = await post({
      app: 'a',
      events: [{ level: 'warn', msg: 'ok' }, { level: 'loud', msg: 'bad' }, { level: 'info' }],
    })
    const body = (await res.json()) as { written: number; rejected: { index: number }[] }
    expect(body.written).toBe(1)
    expect(body.rejected.map((r) => r.index)).toEqual([1, 2])
  })

  it('rejects a batch with no valid events', async () => {
    const res = await post({ app: 'a', events: [{ level: 'nope', msg: 'x' }] })
    expect(res.status).toBe(400)
  })

  it('falls back to receipt time for implausible client timestamps', async () => {
    await post({ app: 'a', events: [{ ts: '2001-01-01T00:00:00.000Z', level: 'info', msg: 'x' }] })
    const [row] = await rows()
    expect(row.ts).toBe(row.received_at)
  })

  it('accepts the legacy single structured event', async () => {
    const res = await post({ app: 'a', level: 'error', msg: 'boom', status: 500 })
    expect(res.status).toBe(200)
    expect((await rows())[0]).toMatchObject({ level: 'error', msg: 'boom', status: 500 })
  })

  it('folds old per-process names into their app and records service and env', async () => {
    await post({ app: 'redesign_api', events: [{ level: 'info', msg: 'a' }] })
    await post({ app: 'talent-backend', env: 'Staging', events: [{ level: 'info', msg: 'b' }] })
    await post({
      app: 'talent-sales',
      service: 'Story Worker',
      events: [{ level: 'info', msg: 'c' }],
    })
    expect((await rows()).map((r) => [r.app, r.service, r.env])).toEqual([
      ['talent-sales', 'talent-backend', 'production'],
      ['talent-sales', 'talent-backend', 'staging'],
      ['talent-sales', 'story-worker', 'production'],
    ])
  })

  it('rejects unstructured lines and level-less messages', async () => {
    expect((await post({ app: 'a', lines: ['one'] })).status).toBe(400)
    expect((await post({ app: 'a', msg: 'one' })).status).toBe(400)
    expect(await rows()).toEqual([])
  })

  it('rejects payloads without app or content', async () => {
    expect((await post({ msg: 'x' })).status).toBe(400)
    expect((await post({ app: 'a' })).status).toBe(400)
    expect((await post({ app: 'a', events: [] })).status).toBe(400)
  })
})
