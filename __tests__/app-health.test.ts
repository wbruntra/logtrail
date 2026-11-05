import { db } from '@database/db'
import app from '@/hono-app/app'
import secrets from '@/secrets'
import { getAppDetail, getOverview } from '@/services/app-health'
import { getEventDetail, listEvents } from '@/services/event-query'
import type { IngestEvent } from '@/services/event-schema'
import { insertEvents, insertLines } from '@/services/event-store'
import { refingerprint } from '@/services/fingerprint-backfill'
import { getIssueDetail, setIssueState } from '@/services/issues'
import { makeWindow } from '@/services/window'
import { beforeEach, describe, expect, it } from 'bun:test'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
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
  await db.deleteFrom('issue_states').execute()
})

describe('makeWindow', () => {
  it('splits the window into aligned buckets that cover now', () => {
    const now = new Date('2026-11-05T07:10:19.604Z')
    const w = makeWindow('24', now)
    expect(w.hours).toBe(24)
    expect(w.bucketMs).toBe(30 * MINUTE)
    expect(w.buckets).toHaveLength(48)
    expect(w.until).toBe('2026-11-05T07:30:00.000Z')
    expect(w.buckets[0]).toBe(w.since)
    expect(Date.parse(w.until) - Date.parse(w.since)).toBe(24 * HOUR)
  })

  it('defaults bad input and clamps to retention', () => {
    expect(makeWindow('nope').hours).toBe(24)
    expect(makeWindow(10_000).hours).toBe(72)
    expect(makeWindow(1).bucketMs).toBe(2 * MINUTE)
  })
})

describe('getOverview', () => {
  it('summarizes each app, with structured apps sorted by errors', async () => {
    await insertEvents('shop', [
      event({ ts: ago(10 * MINUTE) }),
      event({ ts: ago(20 * MINUTE), msg: 'Order 2 not found' }),
      event({ ts: ago(2 * HOUR), level: 'warn', msg: 'slow query', route: '/search' }),
      event({ ts: ago(5 * MINUTE), level: 'info', msg: 'started' }),
    ])
    await insertEvents('auth', [
      event({ ts: ago(HOUR / 2), msg: 'token expired', route: '/login' }),
    ])
    await insertLines('agent', ['plain line', 'another'])

    const o = await getOverview(24)
    expect(o.apps.map((a) => a.app)).toEqual(['shop', 'auth', 'agent'])
    const [shop, , agent] = o.apps
    expect(shop).toMatchObject({
      kind: 'structured',
      events: 4,
      errors: 2,
      warns: 1,
      issues: 2,
      newIssues: 2,
    })
    expect(shop.errorSeries).toHaveLength(48)
    expect(shop.errorSeries.reduce((a, b) => a + b)).toBe(2)
    expect(agent).toMatchObject({ kind: 'lines', events: 2, errors: 0, lastErrorAt: null })
    expect(o.totals).toEqual({ events: 7, errors: 3, warns: 1, issues: 3, newIssues: 3, muted: 0 })
  })

  it('does not count issues as new when they were seen before the window', async () => {
    await insertEvents('shop', [event({ ts: ago(3 * HOUR) }), event({ ts: ago(10 * MINUTE) })])
    const [shop] = (await getOverview(1)).apps
    expect(shop).toMatchObject({ errors: 1, issues: 1, newIssues: 0 })
  })
})

describe('getAppDetail', () => {
  it('returns issues with sparklines, failing routes, statuses and releases', async () => {
    await insertEvents('shop', [
      event({
        ts: ago(10 * MINUTE),
        route: undefined,
        path: '/orders/1',
        status: 404,
        release: 'v2',
      }),
      event({
        ts: ago(20 * MINUTE),
        route: undefined,
        path: '/orders/2',
        status: 404,
        release: 'v2',
      }),
      event({ level: 'warn', msg: 'slow', route: '/search', status: 200, release: 'v1' }),
      event({ level: 'info', msg: 'ok', route: '/health', status: 200 }),
    ])

    const d = (await getAppDetail('shop', 24))!
    expect(d.totals).toEqual({ events: 4, errors: 2, warns: 1, muted: 0 })
    expect(d.issues.map((i) => [i.msg, i.count])).toEqual([
      ['slow', 1],
      ['Order 1 not found', 2],
    ])
    expect(d.issues[1].series.reduce((a, b) => a + b)).toBe(2)
    expect(d.issues[1].isNew).toBe(true)
    expect(d.routes).toEqual([
      { method: 'GET', route: '/orders/:id', errors: 2, warns: 0 },
      { method: 'GET', route: '/search', errors: 0, warns: 1 },
    ])
    expect(d.statuses).toEqual([
      { value: '200', count: 2 },
      { value: '404', count: 2 },
    ])
    expect(d.releases).toEqual([
      { value: 'v2', count: 2 },
      { value: 'v1', count: 1 },
    ])
    expect(await getAppDetail('nope')).toBeNull()
  })
})

describe('getIssueDetail', () => {
  it('breaks occurrences down and pages them', async () => {
    await insertEvents('shop', [
      event({ ts: ago(3 * HOUR), userId: 'u1', release: 'v1', path: '/orders/1' }),
      event({ ts: ago(2 * HOUR), userId: 'u2', release: 'v2', path: '/orders/2' }),
      event({ ts: ago(HOUR), userId: 'u1', release: 'v2', path: '/orders/3' }),
    ])
    const [{ fingerprint }] = (await getAppDetail('shop'))!.issues

    const issue = (await getIssueDetail(fingerprint, 72))!
    expect(issue).toMatchObject({ count: 3, totalCount: 3, users: 2, isNew: true })
    expect(issue.stack).toBeNull()
    expect(issue.breakdowns.releases).toEqual([
      { value: 'v2', count: 2 },
      { value: 'v1', count: 1 },
    ])
    expect(issue.breakdowns.users[0]).toEqual({ value: 'u1', count: 2 })
    expect(issue.occurrences.events.map((e) => e.path)).toEqual([
      '/orders/3',
      '/orders/2',
      '/orders/1',
    ])

    const recent = (await getIssueDetail(fingerprint, 1))!
    expect(recent).toMatchObject({ count: 0, totalCount: 3, isNew: false })
    expect(await getIssueDetail('0000000000000000')).toBeNull()
  })

  it('shows the newest stack trace recorded', async () => {
    const stack = (line: number) => `Error\n    at x (/app/a.ts:${line}:1)`
    await insertEvents('shop', [
      event({ stack: stack(1) }),
      event({ stack: stack(2) }),
      event({ stack: stack(3) }),
    ])
    const [{ fingerprint }] = (await getAppDetail('shop'))!.issues
    expect((await getIssueDetail(fingerprint))!).toMatchObject({ count: 3, stack: stack(3) })
  })
})

describe('issue states', () => {
  async function shopIssues() {
    await insertEvents('shop', [
      event({ ts: ago(20 * MINUTE), msg: 'Order 1 not found' }),
      event({ ts: ago(10 * MINUTE), msg: 'Order 2 not found' }),
      event({
        ts: ago(5 * MINUTE),
        level: 'warn',
        msg: 'scanner',
        route: undefined,
        path: '/.env',
      }),
    ])
    const { issues } = (await getAppDetail('shop'))!
    return {
      orders: issues.find((i) => i.level === 'error')!.fingerprint,
      scanner: issues.find((i) => i.level === 'warn')!.fingerprint,
    }
  }

  it('leaves muted issues out of counts, charts and routes', async () => {
    const { scanner } = await shopIssues()
    await setIssueState([scanner], 'muted')

    const [shop] = (await getOverview()).apps
    expect(shop).toMatchObject({ errors: 2, warns: 0, issues: 1, events: 3 })
    const d = (await getAppDetail('shop'))!
    expect(d.totals).toEqual({ events: 3, errors: 2, warns: 0, muted: 1 })
    expect(d.warnSeries.every((n) => n === 0)).toBe(true)
    expect(d.routes.map((r) => r.route)).toEqual(['/orders/:id'])
    expect(d.issues.find((i) => i.fingerprint === scanner)?.state).toBe('muted')

    await setIssueState([scanner], 'open')
    expect((await getAppDetail('shop'))!.totals.warns).toBe(1)
  })

  it('reopens a resolved issue as a regression when it happens again', async () => {
    const { orders } = await shopIssues()
    await setIssueState([orders], 'resolved')
    expect((await getIssueDetail(orders))!).toMatchObject({ state: 'resolved', regressed: false })
    expect((await getOverview()).apps[0].issues).toBe(1)

    await insertEvents('shop', [event({ msg: 'Order 3 not found' })])
    expect((await getIssueDetail(orders))!).toMatchObject({ state: 'open', regressed: true })
    expect((await getOverview()).apps[0].issues).toBe(2)
  })

  it('carries states over when fingerprints are recomputed', async () => {
    await insertEvents('shop', [
      event({
        level: 'warn',
        route: undefined,
        path: '/sheets/2ExX98E',
        msg: 'GET /sheets/2ExX98E 404',
      }),
      event({
        level: 'warn',
        route: undefined,
        path: '/sheets/YAPe2WZ',
        msg: 'GET /sheets/YAPe2WZ 404',
      }),
    ])
    // Simulate rows fingerprinted before ids like these were recognized
    const rows = await db.selectFrom('events').select('id').orderBy('id').execute()
    await db
      .updateTable('events')
      .set({ fingerprint: 'aaaaaaaaaaaaaaaa' })
      .where('id', '=', rows[0].id)
      .execute()
    await db
      .updateTable('events')
      .set({ fingerprint: 'bbbbbbbbbbbbbbbb' })
      .where('id', '=', rows[1].id)
      .execute()
    await setIssueState(['aaaaaaaaaaaaaaaa'], 'muted')

    expect(await refingerprint(db)).toBe(2)
    const { issues } = (await getAppDetail('shop'))!
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ count: 2, state: 'muted', route: '/sheets/:id' })
    expect(await refingerprint(db)).toBe(0)
  })
})

describe('events', () => {
  it('filters by level, text and app, newest first, a page at a time', async () => {
    await insertEvents('shop', [
      event({ msg: 'first error' }),
      event({ level: 'info', msg: 'hello' }),
      event({ msg: 'second error', code: 'BOOM' }),
    ])
    await insertLines('agent', ['raw boom line'])

    const errors = await listEvents({ app: 'shop', levels: ['error'], limit: 1 })
    expect(errors.events.map((e) => e.msg)).toEqual(['second error'])
    const older = await listEvents({ app: 'shop', levels: ['error'], before: errors.nextBefore! })
    expect(older).toMatchObject({ events: [{ msg: 'first error' }], nextBefore: null })

    const boom = await listEvents({ q: 'boom' })
    expect(boom.events.map((e) => e.msg)).toEqual(['raw boom line', 'second error'])
    const lines = await listEvents({ levels: ['none'] })
    expect(lines.events.map((e) => e.app)).toEqual(['agent'])
  })

  it('catches up on events newer than a cursor, with nextBefore marking a remaining gap', async () => {
    const [held] = await insertLines('agent', ['held'])
    await insertLines('agent', ['missed 1', 'missed 2', 'missed 3'])

    const all = await listEvents({ after: held.id })
    expect(all).toMatchObject({ nextBefore: null })
    expect(all.events.map((e) => e.msg)).toEqual(['missed 3', 'missed 2', 'missed 1'])

    const some = await listEvents({ after: held.id, limit: 2 })
    expect(some.events.map((e) => e.msg)).toEqual(['missed 3', 'missed 2'])
    expect(some.nextBefore).not.toBeNull()
  })

  it('returns an event with its request trace across apps and its neighbors', async () => {
    const [a] = await insertEvents('web', [event({ reqId: 'r1', msg: 'web failed', orderId: 7 })])
    await insertEvents('api', [event({ reqId: 'r1', msg: 'api failed' })])
    await insertEvents('web', [event({ msg: 'later' })])

    const d = (await getEventDetail(a.id))!
    expect(d.event).toMatchObject({ app: 'web', reqId: 'r1', extra: { orderId: 7 } })
    expect(d.trace.map((e) => e.app).sort()).toEqual(['api', 'web'])
    expect(d.before).toEqual([])
    expect(d.after.map((e) => e.msg)).toEqual(['later'])
    expect(await getEventDetail(999_999)).toBeNull()
  })
})

describe('HTTP', () => {
  it('serves apps, issues and events behind login', async () => {
    const [e] = await insertEvents('shop', [event({})])
    const login = await app.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: secrets.password }),
    })
    const { token } = (await login.json()) as { token: string }
    const auth = { headers: { Authorization: `Bearer ${token}` } }

    for (const url of ['/api/apps', '/api/apps/shop', `/api/events/${e.id}`, '/api/events']) {
      expect((await app.request(url)).status).toBe(401)
      expect((await app.request(url, auth)).status).toBe(200)
    }
    expect((await app.request(`/api/issues/${e.fingerprint}`, auth)).status).toBe(200)
    expect((await app.request(`/api/issues/${e.fingerprint}/events`, auth)).status).toBe(200)
    expect((await app.request('/api/apps/nope', auth)).status).toBe(404)
    expect((await app.request('/api/issues/nope', auth)).status).toBe(404)
    expect((await app.request('/api/events/abc', auth)).status).toBe(404)

    const post = (body: unknown) =>
      app.request('/api/issues/state', {
        method: 'POST',
        headers: { ...auth.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await post({ fingerprints: [e.fingerprint], state: 'muted' })).status).toBe(200)
    expect((await getIssueDetail(e.fingerprint!))!.state).toBe('muted')
    expect((await post({ fingerprints: ['nope'], state: 'muted' })).status).toBe(400)
    expect((await post({ fingerprints: [e.fingerprint], state: 'gone' })).status).toBe(400)
  })
})
