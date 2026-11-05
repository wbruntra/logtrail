import { fingerprint, normalizePath, topFrame } from '@/services/fingerprint'
import { describe, expect, it } from 'bun:test'

const base = { app: 'a', level: 'error', msg: 'Order 1234 not found', route: '/orders/:id' }

describe('fingerprint', () => {
  it('groups messages that differ only by ids and numbers', () => {
    expect(fingerprint(base)).toBe(fingerprint({ ...base, msg: 'Order 98 not found' }))
    expect(fingerprint({ ...base, msg: 'user 3f2a9c81d0 failed' })).toBe(
      fingerprint({ ...base, msg: 'user 77bb01ee42 failed' }),
    )
  })

  it('separates different routes, statuses and codes', () => {
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, route: '/users/:id' }))
    expect(fingerprint({ ...base, status: 404 })).not.toBe(fingerprint({ ...base, status: 500 }))
    expect(fingerprint({ ...base, code: 'A' })).not.toBe(fingerprint({ ...base, code: 'B' }))
  })

  it('ignores line numbers in the stack', () => {
    const at = (line: number) => `Error: x\n    at load (/app/src/orders.ts:${line}:5)`
    expect(fingerprint({ ...base, stack: at(10) })).toBe(fingerprint({ ...base, stack: at(42) }))
  })

  it('only fingerprints errors and warnings', () => {
    expect(fingerprint({ ...base, level: 'info' })).toBeNull()
    expect(fingerprint({ ...base, level: null })).toBeNull()
  })

  it('normalizes ids in paths', () => {
    expect(normalizePath('/users/123/files/550e8400-e29b-41d4-a716-446655440000?x=1')).toBe(
      '/users/:id/files/:id',
    )
  })

  it('skips dependency frames', () => {
    const stack = [
      'Error: x',
      '    at fn (/app/node_modules/lib/index.js:1:1)',
      '    at handler (/app/src/a.ts:3:9)',
    ].join('\n')
    expect(topFrame(stack)).toBe('at handler (/app/src/a.ts)')
  })
})
