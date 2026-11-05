import { db } from '@database/db'
import router from '@/hono-app/routes/ingest'
import secrets from '@/secrets'
import { getAllLines } from '@/services/ingest-store'
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
      app: 'shop_api',
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

    // Dual-written to the legacy file store for the viewer
    const lines = getAllLines('shop_api').map((l) => JSON.parse(l))
    expect(lines[0]).toMatchObject({ ts, level: 'error', tenant: 'acme', userId: '42' })
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

  it('stores agent lines with no level', async () => {
    await post({ app: 'agent', lines: ['one', '  ', 'two'] })
    await post({ app: 'agent', msg: 'three' })
    const stored = await rows()
    expect(stored.map((r) => [r.level, r.msg])).toEqual([
      [null, 'one'],
      [null, 'two'],
      [null, 'three'],
    ])
  })

  it('rejects payloads without app or content', async () => {
    expect((await post({ msg: 'x' })).status).toBe(400)
    expect((await post({ app: 'a' })).status).toBe(400)
    expect((await post({ app: 'a', events: [] })).status).toBe(400)
  })
})
