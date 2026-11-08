import { db } from '@database/db'
import app from '@/hono-app/app'
import secrets from '@/secrets'
import type { IngestEvent } from '@/services/event-schema'
import { insertEvents, insertLines } from '@/services/event-store'
import { beforeEach, describe, expect, it } from 'bun:test'

function event(overrides: Partial<IngestEvent>): IngestEvent {
  return {
    level: 'error',
    msg: 'Order 1 not found',
    method: 'GET',
    path: '/orders/1',
    ...overrides,
  }
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await app.request('/api/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secrets.mcpToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const { result } = (await res.json()) as {
    result: { content: { text: string }[]; isError?: boolean }
  }
  if (result.isError) throw new Error(result.content[0].text)
  return JSON.parse(result.content[0].text)
}

beforeEach(async () => {
  await db.deleteFrom('events').execute()
})

describe('mcp tools', () => {
  it('lists sources with counts, kind, services and envs', async () => {
    await insertEvents('talent-sales', [event({})], { service: 'tpp-auth', env: 'production' })
    await insertEvents('talent-sales', [event({})], { service: 'api', env: 'staging' })
    await insertLines('old', ['old line'])
    const { sources } = await call('list_log_sources')
    const ingested = sources.filter((s: { type: string }) => s.type === 'ingested')
    expect(ingested).toMatchObject([
      { name: 'old', kind: 'lines', eventCount: 1 },
      {
        name: 'talent-sales',
        kind: 'sdk',
        eventCount: 2,
        services: ['api', 'tpp-auth'],
        envs: ['production', 'staging'],
      },
    ])
  })

  it('narrows search, history and summary to a service and env', async () => {
    await insertEvents('talent-sales', [event({ msg: 'auth down' })], {
      service: 'tpp-auth',
      env: 'production',
    })
    await insertEvents('talent-sales', [event({ msg: 'api down' })], {
      service: 'api',
      env: 'staging',
    })
    const found = await call('search_logs', { query: 'down', service: 'tpp-auth' })
    expect(found.results.map((r: { msg: string }) => r.msg)).toEqual(['auth down'])
    expect(found.results[0]).toMatchObject({ service: 'tpp-auth', env: 'production' })
    const staging = await call('read_logs', { source: 'ingested:talent-sales', env: 'staging' })
    expect(staging.lines).toHaveLength(1)
    const summary = await call('get_error_summary', { source: 'talent-sales', env: 'staging' })
    expect(summary.totals.errors).toBe(1)
  })

  it('summarizes one app compactly and notes missing releases', async () => {
    await insertEvents('shop', [
      event({ stack: 'Error\n    at x (/app/a.ts:1:1)' }),
      event({ msg: 'boom', path: '/pay' }),
    ])
    await insertEvents('auth', [event({ release: 'v1' })])

    const summary = await call('get_error_summary', { source: 'ingested:shop', issues: 1 })
    expect(summary.app).toBe('shop')
    expect(summary.issues).toHaveLength(1)
    expect(summary.issuesTruncated).toBe(true)
    expect(summary.recentErrors.every((e: object) => !('stack' in e))).toBe(true)
    expect(summary.notes).toEqual([expect.stringContaining('shop reported no release')])
  })

  it('drills into an issue with breakdowns and window counts', async () => {
    await insertEvents('shop', [event({ status: 404 }), event({ path: '/orders/2', status: 404 })])
    const [{ fingerprint }] = (await call('get_error_summary')).issues
    const issue = await call('get_issue', { fingerprint, limit: 1 })
    expect(issue).toMatchObject({ fingerprint, count: 2, totalCount: 2 })
    expect(issue.breakdowns.statuses).toEqual([{ value: '404', count: 2 }])
    expect(issue.occurrences.events).toHaveLength(1)
    expect(issue.window.buckets).toBeUndefined()
    expect(issue.notes).toHaveLength(1)
  })

  it('searches with structured filters and returns parsed events', async () => {
    await insertEvents('shop', [event({ status: 500 }), event({ status: 404 })])
    const { results } = await call('search_logs', { source: 'shop', status: '5xx' })
    expect(results).toMatchObject([{ app: 'shop', status: 500, msg: 'Order 1 not found' }])
    await expect(call('search_logs', {})).rejects.toThrow('Provide a query or at least one filter')
  })

  it('hides muted and resolved issues, and reopens a resolved one that recurs', async () => {
    await insertEvents('shop', [
      event({ msg: 'scanner hit', path: '/x', status: 404, code: 'SCAN' }),
      event({ msg: 'real bug', code: 'BUG' }),
    ])
    const { issues } = await call('get_error_summary')
    const fp = (code: string) => issues.find((i: { code: string }) => i.code === code).fingerprint

    await call('set_issue_state', { fingerprints: [fp('SCAN')], state: 'muted' })
    const after = await call('get_error_summary')
    expect(after.issues.map((i: { code: string }) => i.code)).toEqual(['BUG'])
    expect(after.totals.errors).toBe(1)

    const all = await call('get_error_summary', { includeTriaged: true })
    expect(all.issues).toHaveLength(2)
    expect(all.issues.find((i: { code: string }) => i.code === 'SCAN').state).toBe('muted')

    await call('set_issue_state', { fingerprints: [fp('BUG')], state: 'resolved' })
    expect((await call('get_error_summary')).issues).toHaveLength(0)
    await Bun.sleep(5)
    await insertEvents('shop', [event({ msg: 'real bug', code: 'BUG' })])
    const reopened = await call('get_error_summary')
    expect(reopened.issues).toMatchObject([{ code: 'BUG', state: 'open', regressed: true }])

    await expect(
      call('set_issue_state', { fingerprints: ['0123456789abcdef'], state: 'muted' }),
    ).rejects.toThrow('No issue with fingerprint')
  })

  it('sorts issues by count, filters by release and finds new issues', async () => {
    await insertEvents('shop', [
      event({ code: 'RARE', release: 'v1' }),
      ...[1, 2, 3].map(() => event({ code: 'COMMON', release: 'v2' })),
    ])
    const recent = await call('get_error_summary', { sort: 'count' })
    expect(recent.issues.map((i: { code: string }) => i.code)).toEqual(['COMMON', 'RARE'])
    const v1 = await call('get_error_summary', { release: 'v1' })
    expect(v1.issues.map((i: { code: string }) => i.code)).toEqual(['RARE'])
    const fresh = await call('get_error_summary', { newOnly: true })
    expect(fresh.issues).toHaveLength(2)
  })

  it('filters search by extra fields', async () => {
    await insertEvents('shop', [
      event({ msg: 'a', tokenId: 2239, platform: 'instagram' } as never),
      event({ msg: 'b', tokenId: 1, platform: 'youtube' } as never),
    ])
    const byPlatform = await call('search_logs', { extra: { platform: 'youtube' } })
    expect(byPlatform.results.map((r: { msg: string }) => r.msg)).toEqual(['b'])
    const byNumber = await call('search_logs', { extra: { tokenId: 2239 } })
    expect(byNumber.results.map((r: { msg: string }) => r.msg)).toEqual(['a'])
    await expect(call('search_logs', { extra: { 'a.b': 1 } })).rejects.toThrow(
      'Invalid extra field name',
    )
  })

  it('counts events per field value', async () => {
    await insertEvents('shop', [
      event({ platform: 'instagram', status: 500 } as never),
      event({ platform: 'instagram', status: 404 } as never),
      event({ platform: 'youtube', status: 500 } as never),
    ])
    const byPlatform = await call('count_events', { groupBy: 'extra.platform' })
    expect(byPlatform.groups).toMatchObject([
      { value: 'instagram', count: 2 },
      { value: 'youtube', count: 1 },
    ])
    const serverErrors = await call('count_events', { groupBy: 'status', status: '5xx' })
    expect(serverErrors.groups).toMatchObject([{ value: 500, count: 2 }])
    await expect(call('count_events', { groupBy: 'nope' })).rejects.toThrow('groupBy must be')
  })
})
