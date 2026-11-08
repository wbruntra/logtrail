import { fingerprint, isSlugId, normalizePath, topFrame } from '@/services/fingerprint'
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
    expect(normalizePath('/public/talent-sheet/roster-view/2ExX98E')).toBe(
      '/public/talent-sheet/roster-view/:id',
    )
    expect(normalizePath('/auth/8sMSLicD9Q8Xl8wfP4fPB_XCeJ0UGX_XFXDOIkGgteQ')).toBe('/auth/:id')
  })

  it('keeps words and version segments in paths', () => {
    expect(normalizePath('/api/v2/roster-view/settings')).toBe('/api/v2/roster-view/settings')
    expect(normalizePath('/api/advanced-filters-ai/oauth2')).toBe('/api/advanced-filters-ai/oauth2')
    expect(normalizePath('/api/system/fileView/TalentSheets')).toBe(
      '/api/system/fileView/TalentSheets',
    )
  })

  it('recognizes letter-only ids by their irregular case', () => {
    for (const id of ['KvxBvxE', 'wAQkxdm', 'eVZaxKP', 'ZbXQDVd']) expect(isSlugId(id)).toBe(true)
    for (const word of ['fileView', 'TalentSheets', 'settings', 'roster-view', 'v2', 'oauth2'])
      expect(isSlugId(word)).toBe(false)
  })

  it('groups requests to the same route whose message embeds the path', () => {
    const req = (path: string) => ({
      app: 'a',
      level: 'warn',
      method: 'GET',
      path,
      status: 404,
      msg: `GET ${path} 404`,
    })
    expect(fingerprint(req('/public/talent-sheet/roster-view/2ExX98E'))).toBe(
      fingerprint(req('/public/talent-sheet/roster-view/YAPe2WZ')),
    )
    expect(fingerprint(req('/public/profile/eVZaxKP/team/ZbXQDVd'))).toBe(
      fingerprint(req('/public/profile/qP1ydOP/team/ewnlGb9')),
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

  it('groups per-account log lines but keeps the failure category', () => {
    const line = (account: string, category: string) =>
      fingerprint({
        app: 'a',
        level: 'warn',
        msg: `task FAIL token=2239 platform=instagram account=${account} social_account=16903 influencer=8979 category=${category} ms=6230`,
      })
    expect(line('selinarose_', 'UNKNOWN_ERROR')).toBe(line('solcarlosofficial', 'UNKNOWN_ERROR'))
    expect(line('selinarose_', 'UNKNOWN_ERROR')).not.toBe(line('selinarose_', 'AUTH_ERROR'))
  })

  it('folds quoted identity values and camelCase id keys', () => {
    const a = fingerprint({ app: 'a', level: 'error', msg: 'failed user="Jo Bloggs" sheetId=abc' })
    const b = fingerprint({ app: 'a', level: 'error', msg: 'failed user="Al Smith" sheetId=xyz' })
    expect(a).toBe(b)
  })
})
