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
  it('lists sources with counts, kind and name variants', async () => {
    await insertEvents('tpp-auth', [event({})])
    await insertLines('tpp_auth', ['old line'])
    const { sources } = await call('list_log_sources')
    const ingested = sources.filter((s: { type: string }) => s.type === 'ingested')
    expect(ingested).toMatchObject([
      { name: 'tpp-auth', kind: 'sdk', eventCount: 1, similarTo: ['tpp_auth'] },
      { name: 'tpp_auth', kind: 'agent', eventCount: 1, similarTo: ['tpp-auth'] },
    ])
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
})
