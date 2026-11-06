import { parseLines } from '@/services/line-parser'
import { describe, expect, it } from 'bun:test'

describe('parseLines', () => {
  it('reads morgan access lines, with colour codes, into request fields', () => {
    const [ok, missing, boom] = parseLines([
      '\x1b[0mGET /api/status \x1b[32m200\x1b[0m 0.373 ms - 16\x1b[0m',
      'GET /api/users/12?x=1 404 1.2 ms - 21',
      'POST /api/pay 500 30.5 ms - -',
    ])
    expect(ok).toMatchObject({ level: 'debug', method: 'GET', path: '/api/status', status: 200 })
    expect(ok.duration).toBe(0.373)
    expect(missing).toMatchObject({
      level: 'warn',
      msg: 'GET /api/users/12 404',
      path: '/api/users/12',
    })
    expect(boom).toMatchObject({ level: 'error', status: 500 })
  })

  it('maps JSON lines from pino and others', () => {
    const [pino, named, withErr] = parseLines([
      JSON.stringify({ level: 50, time: 1793945000000, msg: 'db down', reqId: 'r1', tenant: 'a' }),
      JSON.stringify({ level: 'warning', message: 'slow', timestamp: '2026-11-06T07:00:00Z' }),
      JSON.stringify({ err: { message: 'boom', stack: 'Error: boom\n    at x', code: 'E1' } }),
    ])
    expect(pino).toMatchObject({ level: 'error', msg: 'db down', reqId: 'r1', tenant: 'a' })
    expect(pino.ts).toBe(new Date(1793945000000).toISOString())
    expect(named).toMatchObject({ level: 'warn', msg: 'slow', ts: '2026-11-06T07:00:00.000Z' })
    expect(withErr).toMatchObject({ level: 'error', msg: 'boom', code: 'E1' })
    expect(withErr.stack).toContain('at x')
  })

  it('takes a leading timestamp and level word off plain text', () => {
    const [a, b, c] = parseLines([
      '2026-11-05T09:20:02.443Z OAuth task worker ran: no tasks found',
      'ERROR: connection refused',
      '[event-reminders] done in 11ms',
    ])
    expect(a).toMatchObject({ level: 'info', msg: 'OAuth task worker ran: no tasks found' })
    expect(a.ts).toBe('2026-11-05T09:20:02.443Z')
    expect(b).toMatchObject({ level: 'error', msg: 'connection refused' })
    expect(c).toMatchObject({ level: 'info', msg: '[event-reminders] done in 11ms' })
  })

  it('joins stack frames to the line before and skips blank lines', () => {
    const events = parseLines([
      'ERROR: crashed',
      '    at a (/x.js:1:1)',
      '',
      '    at b (/x.js:2:2)',
      'next',
    ])
    expect(events).toHaveLength(2)
    expect(events[0].stack).toBe('crashed\n    at a (/x.js:1:1)\n    at b (/x.js:2:2)')
  })
})
