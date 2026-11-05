import { db } from '@database/db'
import app from '@/hono-app/app'
import { parseLine } from '@/scripts/import-ingested-logs'
import secrets from '@/secrets'
import type { IngestEvent } from '@/services/event-schema'
import { appStats, getContext, getHistory, getTail, listApps } from '@/services/event-query'
import { insertEvents, insertLines } from '@/services/event-store'
import { searchEvents, searchLogs } from '@/services/log-search'
import { deleteExpired } from '@/services/retention'
import { beforeEach, describe, expect, it } from 'bun:test'

const ids = (lines: { lineNumber: number }[]) => lines.map((l) => l.lineNumber)

function event(overrides: Partial<IngestEvent>): IngestEvent {
  return { level: 'error', msg: 'boom', ...overrides }
}

async function ok<T>(result: T | { error: string }): Promise<T> {
  if (result && typeof result === 'object' && 'error' in result) throw new Error(result.error)
  return result as T
}

beforeEach(async () => {
  await db.deleteFrom('events').execute()
})

describe('history', () => {
  it('pages backwards through one app, oldest first within a page', async () => {
    const rows = await insertLines(
      'a',
      ['1', '2', '3', '4', '5'].map((n) => `line ${n}`),
    )
    await insertLines('other', ['not mine'])

    const newest = await getHistory('a', undefined, 2)
    expect(newest.lines.map((l) => l.content.split(' ').slice(1).join(' '))).toEqual([
      'line 4',
      'line 5',
    ])
    expect(newest).toMatchObject({ hasMore: true, totalLines: 5 })

    const older = await getHistory('a', newest.nextBefore!, 2)
    expect(ids(older.lines)).toEqual([rows[1].id, rows[2].id])
    const oldest = await getHistory('a', older.nextBefore!, 2)
    expect(ids(oldest.lines)).toEqual([rows[0].id])
    expect(oldest).toMatchObject({ hasMore: false, nextBefore: null })
  })

  it('renders lines the way the file store did', async () => {
    await insertLines('a', ['plain'])
    await insertEvents('a', [event({ code: 'X', tenant: 't1' })])
    const [plain, structured] = (await getHistory('a')).lines
    expect(plain.content).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z plain$/)
    expect(JSON.parse(structured.content)).toMatchObject({
      level: 'error',
      msg: 'boom',
      code: 'X',
      tenant: 't1',
    })
    expect(await getTail('a', 1)).toBe(structured.content)
  })

  it('lists apps', async () => {
    await insertLines('b', ['x'])
    await insertLines('a', ['x'])
    expect(await listApps()).toEqual(['a', 'b'])
  })
})

describe('context', () => {
  it('returns neighbours from the same app around a line', async () => {
    const rows = await insertLines(
      'a',
      ['1', '2', '3', '4', '5'].map((n) => `line ${n}`),
    )
    await insertLines('other', ['interleaved'])
    const ctx = (await getContext('a', rows[1].id, 2))!
    expect(ids(ctx.lines)).toEqual([rows[0].id, rows[1].id, rows[2].id, rows[3].id])
    expect(ctx.lines.filter((l) => l.isTarget).map((l) => l.lineNumber)).toEqual([rows[1].id])
    expect(ctx).toMatchObject({ startLine: rows[0].id, endLine: rows[3].id, totalLines: 5 })
    expect(await getContext('other', rows[1].id, 2)).toBeNull()
  })
})

describe('searchLogs', () => {
  beforeEach(async () => {
    await insertEvents('shop', [
      event({ msg: 'Payment declined', code: 'CARD', reqId: 'r1', path: '/pay' }),
      event({ msg: 'Order 7 missing', reqId: 'r2', level: 'warn' }),
    ])
    await insertLines('agent', ['GET /health 200 r1', 'disk almost full'])
  })

  it('matches substrings across fields, case-insensitively by default', async () => {
    const r = await ok(await searchLogs({ query: 'PAYMENT' }))
    expect(r.results.map((m) => m.app)).toEqual(['shop'])
    expect((await ok(await searchLogs({ query: '/pay' }))).totalMatches).toBe(1)
    expect((await ok(await searchLogs({ query: 'card' }))).totalMatches).toBe(1)
    expect(
      (await ok(await searchLogs({ query: 'PAYMENT', caseSensitive: true }))).totalMatches,
    ).toBe(0)
  })

  it('matches regexes against the rendered line', async () => {
    const r = await ok(await searchLogs({ query: 'order \\d+', regex: true }))
    expect(r.results.map((m) => JSON.parse(m.content).msg)).toEqual(['Order 7 missing'])
    expect(await searchLogs({ query: '(', regex: true })).toEqual({ error: 'Invalid regex' })
  })

  it('filters by request id: the column for events, the text for agent lines', async () => {
    const r = await ok(await searchLogs({ reqId: 'r1' }))
    expect(r.results.map((m) => m.app).sort()).toEqual(['agent', 'shop'])
  })

  it('filters by app and time window', async () => {
    expect((await ok(await searchLogs({ app: 'agent', query: 'disk' }))).appsSearched).toEqual([
      'agent',
    ])
    const future = new Date(Date.now() + 60_000).toISOString()
    expect((await ok(await searchLogs({ query: 'disk', since: future }))).totalMatches).toBe(0)
    expect((await ok(await searchLogs({ query: 'disk', until: future }))).totalMatches).toBe(1)
    expect(await searchLogs({ since: 'yesterday-ish' })).toEqual({
      error: 'since/until must be ISO timestamps',
    })
  })

  it('keeps the newest matches, reports the total, and adds context', async () => {
    const lines = await insertLines(
      'bulk',
      Array.from({ length: 10 }, (_, i) => `match ${i}`),
    )
    for (const regex of [false, true]) {
      const r = await ok(
        await searchLogs({ app: 'bulk', query: 'match', regex, limit: 3, context: 1 }),
      )
      expect(r).toMatchObject({ totalMatches: 10, truncated: true })
      expect(ids(r.results)).toEqual(lines.slice(7).map((l) => l.id))
      expect(ids(r.results[2].context!)).toEqual([lines[8].id])
    }
  })
})

describe('searchEvents', () => {
  beforeEach(async () => {
    await insertEvents('api', [
      event({ msg: 'not found', status: 404, path: '/api/sheets/abc', route: '/api/sheets/:id' }),
      event({ msg: 'crashed', status: 500, path: '/api/pay', code: 'CARD', userId: 'u1' }),
      event({ msg: 'slow', level: 'warn', status: 200, path: '/api/sheets' }),
    ])
    await insertLines('agent', ['GET /api/sheets 500'])
  })

  const msgs = async (options: Parameters<typeof searchEvents>[0]) =>
    (await ok(await searchEvents(options))).results.map((e) => e.msg)

  it('returns parsed events', async () => {
    const [e] = (await ok(await searchEvents({ code: 'CARD' }))).results
    expect(e).toMatchObject({ app: 'api', msg: 'crashed', status: 500, userId: 'u1' })
  })

  it('filters by level, status, code, user, route and path prefix', async () => {
    expect(await msgs({ levels: ['warn'] })).toEqual(['slow'])
    expect(await msgs({ levels: ['none'] })).toEqual(['GET /api/sheets 500'])
    expect(await msgs({ status: 404 })).toEqual(['not found'])
    expect(await msgs({ status: '5xx' })).toEqual(['crashed'])
    expect(await msgs({ status: '4XX' })).toEqual(['not found'])
    expect(await msgs({ userId: 'u1' })).toEqual(['crashed'])
    expect(await msgs({ route: '/api/sheets/:id' })).toEqual(['not found'])
    expect(await msgs({ pathPrefix: '/api/sheets' })).toEqual(['not found', 'slow'])
    expect(await searchEvents({ status: 'teapot' })).toEqual({
      error: "status must be a number or a class such as '5xx'",
    })
  })

  it('adds context as events', async () => {
    const [match] = (await ok(await searchEvents({ code: 'CARD', context: 1 }))).results
    expect(match.context!.map((e) => e.msg)).toEqual(['not found', 'slow'])
  })
})

describe('appStats', () => {
  it('counts structured events and agent lines per app', async () => {
    await insertEvents('api', [event({}), event({ level: 'info' })])
    await insertLines('api', ['plain'])
    await insertLines('agent', ['plain'])
    expect(await appStats()).toMatchObject([
      { app: 'agent', eventCount: 1, structured: 0, unstructured: 1 },
      { app: 'api', eventCount: 3, structured: 2, unstructured: 1 },
    ])
  })
})

describe('retention', () => {
  it('deletes events received before the cutoff', async () => {
    const [old] = await insertLines('a', ['old'])
    await insertLines('a', ['new'])
    await db
      .updateTable('events')
      .set({ received_at: new Date(Date.now() - 4 * 86400_000).toISOString() })
      .where('id', '=', old.id)
      .execute()
    expect(await deleteExpired()).toBe(1)
    expect((await getHistory('a')).lines.map((l) => l.content.endsWith('new'))).toEqual([true])
  })
})

describe('import', () => {
  it('parses both file-store line formats', () => {
    expect(parseLine('a', '2026-11-01T10:00:00.000Z GET /x 200')).toMatchObject({
      ts: '2026-11-01T10:00:00.000Z',
      received_at: '2026-11-01T10:00:00.000Z',
      level: null,
      msg: 'GET /x 200',
    })
    const structured = '{"ts":"2026-11-01T10:00:00.000Z","level":"error","msg":"boom","code":"X"}'
    expect(parseLine('a', structured)).toMatchObject({
      ts: '2026-11-01T10:00:00.000Z',
      level: 'error',
      code: 'X',
    })
    expect(parseLine('a', 'no timestamp here')).toBeNull()
  })
})

describe('logs routes', () => {
  async function auth() {
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: secrets.password }),
    })
    const { token } = (await res.json()) as { token: string }
    return { Authorization: `Bearer ${token}` }
  }

  it('serves ingested history, search and context from the database', async () => {
    const headers = await auth()
    const rows = await insertLines('web', ['alpha', 'beta', 'gamma'])

    const list = (await (await app.request('/api/logs/list', { headers })).json()) as any
    expect(list.logs.map((l: { path: string }) => l.path)).toContain('ingested:web')

    const history = (await (
      await app.request('/api/logs/history?file=ingested:web&limit=2', { headers })
    ).json()) as any
    expect(history).toMatchObject({ hasMore: true, nextBefore: rows[1].id, totalLines: 3 })

    const search = (await (
      await app.request('/api/logs/search?file=ingested:web&query=BETA', { headers })
    ).json()) as any
    expect(search).toMatchObject({ totalMatches: 1, truncated: false })
    expect(search.results[0].lineNumber).toBe(rows[1].id)

    const ctx = await app.request(`/api/logs/context/${rows[1].id}?file=ingested:web&context=1`, {
      headers,
    })
    expect(ids(((await ctx.json()) as any).lines)).toEqual(rows.map((r) => r.id))
    expect(
      (await app.request('/api/logs/context/999999?file=ingested:web', { headers })).status,
    ).toBe(404)
  })

  it('streams new events for the app', async () => {
    const headers = await auth()
    const abort = new AbortController()
    const res = await app.request('/api/logs/stream?file=ingested:live', {
      headers,
      signal: abort.signal,
    })
    const reader = res.body!.getReader()

    await insertLines('elsewhere', ['not for this stream'])
    const [row] = await insertLines('live', ['hello stream'])

    const chunk = new TextDecoder().decode((await reader.read()).value)
    abort.abort()
    const data = JSON.parse(chunk.match(/^data: (.*)$/m)![1])
    expect(data).toMatchObject({ lineNumber: row.id })
    expect(data.content).toEndWith('hello stream')
  })
})
