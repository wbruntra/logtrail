import { db } from '@database/db'
import app from '@/hono-app/app'
import secrets from '@/secrets'
import { getDashboard, getIssue } from '@/services/dashboard'
import type { IngestEvent } from '@/services/event-schema'
import { insertEvents, insertLines } from '@/services/event-store'
import { beforeEach, describe, expect, it } from 'bun:test'

const HOUR = 60 * 60 * 1000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

function event(overrides: Partial<IngestEvent>): IngestEvent {
  return {
    level: 'error',
    msg: 'Order 1 not found',
    method: 'GET',
    route: '/orders/:id',
    ...overrides,
  }
}

beforeEach(async () => {
  await db.deleteFrom('events').execute()
})

describe('getDashboard', () => {
  it('counts errors and warnings by app, hour and code within the window', async () => {
    await insertEvents('shop', [
      event({ ts: ago(10 * 60 * 1000), code: 'NOT_FOUND' }),
      event({ ts: ago(20 * 60 * 1000), code: 'NOT_FOUND' }),
      event({ ts: ago(2 * HOUR), level: 'warn', msg: 'slow query', code: 'SLOW' }),
      event({ ts: ago(5 * 60 * 1000), level: 'info', msg: 'ignored' }),
    ])
    await insertEvents('auth', [event({ ts: ago(HOUR / 2), msg: 'token expired' })])
    await insertLines('agent', ['plain line'])

    const d = await getDashboard({ hours: '24' })

    expect(d.totals).toEqual({ errors: 3, warns: 1 })
    expect(d.byApp).toEqual([
      { app: 'shop', errors: 2, warns: 1 },
      { app: 'auth', errors: 1, warns: 0 },
    ])
    expect(d.topCodes).toEqual([
      { code: 'NOT_FOUND', count: 2 },
      { code: 'SLOW', count: 1 },
    ])
    expect(d.byHour).toHaveLength(24)
    expect(d.byHour.reduce((n, h) => n + h.errors + h.warns, 0)).toBe(4)
    expect(d.recentErrors.map((e) => e.msg)).toEqual([
      'Order 1 not found',
      'Order 1 not found',
      'token expired',
      'slow query',
    ])
  })

  it('excludes events outside the window and caps the window', async () => {
    // Older than the 24h clamp in event-store, so stored with receipt time; insert directly
    await insertEvents('shop', [event({})])
    await db
      .updateTable('events')
      .set({ ts: ago(30 * HOUR) })
      .execute()
    expect((await getDashboard({ hours: 24 })).totals).toEqual({ errors: 0, warns: 0 })
    expect((await getDashboard({ hours: 48 })).totals).toEqual({ errors: 1, warns: 0 })
    expect((await getDashboard({ hours: 1000 })).period).toBe(72)
  })

  it('filters recent events and issues by level', async () => {
    await insertEvents('shop', [event({}), event({ level: 'warn', msg: 'slow' })])
    const d = await getDashboard({ levels: 'warn' })
    expect(d.recentErrors.map((e) => e.level)).toEqual(['warn'])
    expect(d.issues.map((i) => i.level)).toEqual(['warn'])
    expect(d.totals).toEqual({ errors: 1, warns: 1 })
  })
})

describe('issues', () => {
  it('groups occurrences of the same problem', async () => {
    await insertEvents('shop', [
      event({ ts: ago(3 * HOUR), msg: 'Order 1 not found', userId: 'u1', release: 'v1' }),
      event({ ts: ago(2 * HOUR), msg: 'Order 2 not found', userId: 'u2', release: 'v2' }),
      event({ ts: ago(1 * HOUR), msg: 'Order 3 not found', userId: 'u1', release: 'v2' }),
      event({ ts: ago(4 * HOUR), msg: 'Payment declined', route: '/pay' }),
    ])

    const { issues } = await getDashboard()
    expect(issues).toHaveLength(2)
    const [orders, payment] = issues
    expect(orders).toMatchObject({
      app: 'shop',
      msg: 'Order 3 not found',
      route: '/orders/:id',
      count: 3,
      users: 2,
      releases: ['v1', 'v2'],
    })
    expect(Date.now() - Date.parse(orders.firstSeen)).toBeGreaterThanOrEqual(3 * HOUR)
    expect(Date.now() - Date.parse(orders.lastSeen)).toBeLessThan(2 * HOUR)
    expect(payment).toMatchObject({ msg: 'Payment declined', count: 1, users: 0, releases: [] })
  })

  it('limits to one app and a number of issues, and can leave out stacks', async () => {
    await insertEvents('shop', [
      event({ msg: 'one', stack: 'Error\n    at x (/app/a.ts:1:1)' }),
      event({ msg: 'two' }),
    ])
    await insertEvents('auth', [event({ msg: 'three' })])

    const d = await getDashboard({ app: 'shop', issueLimit: 1, stacks: false })
    expect(d.totals).toEqual({ errors: 2, warns: 0 })
    expect(d.byApp.map((a) => a.app)).toEqual(['shop'])
    expect(d.issues).toHaveLength(1)
    expect(d.recentErrors.map((e) => [e.msg, 'stack' in e, 'hasStack' in e && e.hasStack])).toEqual(
      [
        ['two', false, false],
        ['one', false, true],
      ],
    )
  })

  it('returns an issue with its occurrences, newest first', async () => {
    await insertEvents('shop', [
      event({ msg: 'Order 1 not found', reqId: 'a', stack: 'Error\n    at x (/app/a.ts:1:1)' }),
      event({ msg: 'Order 2 not found', reqId: 'b', stack: 'Error\n    at x (/app/a.ts:9:9)' }),
    ])
    const [{ fingerprint }] = (await getDashboard()).issues

    const issue = await getIssue(fingerprint)
    expect(issue).toMatchObject({ fingerprint, count: 2 })
    expect(issue!.events.map((e) => e.reqId)).toEqual(['b', 'a'])
    expect(issue!.events[0].stack).toContain('a.ts:9:9')
    expect(await getIssue('0000000000000000')).toBeNull()
  })

  it('serves issues over HTTP behind login', async () => {
    await insertEvents('shop', [event({})])
    const [{ fingerprint }] = (await getDashboard()).issues
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: secrets.password }),
    })
    const { token } = (await login.json()) as { token: string }
    const auth = { headers: { Authorization: `Bearer ${token}` } }

    expect((await app.request(`/api/dashboard/issues/${fingerprint}`)).status).toBe(401)
    const res = await app.request(`/api/dashboard/issues/${fingerprint}`, auth)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ fingerprint, count: 1 })
    expect((await app.request('/api/dashboard/issues/nope', auth)).status).toBe(404)
  })
})
