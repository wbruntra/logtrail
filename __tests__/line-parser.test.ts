import { MAX_BLOCK_LINES, completeLineCount, parseLines } from '@/services/line-parser'
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

  it('keeps 4xx/5xx access lines as debug when requestAlerts is off', () => {
    const [failed] = parseLines(['POST /api/pay 500 12 ms - 9'], { requestAlerts: false })
    expect(failed).toMatchObject({ level: 'debug', status: 500, msg: 'POST /api/pay 500' })
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

  it('keeps a pretty-printed object as one event instead of one per field', () => {
    const events = parseLines([
      'sending notification {',
      '  type: "influencer-added",',
      '  items: [',
      '    {',
      '      error: false,',
      '    }, {',
      '      id: 2',
      '    }',
      '  ],',
      '}',
      'next line',
    ])
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ level: 'info' })
    expect(events[0].msg.split('\n')).toHaveLength(10)
    expect(events[0].msg).toContain('error: false,')
    expect(events[1].msg).toBe('next line')
  })

  it('reads the level from the first line of an object, not its fields', () => {
    const [failed] = parseLines(['ERROR: task failed {', '  info: 1,', '}'])
    expect(failed).toMatchObject({ level: 'error' })
    expect(failed.msg).toContain('info: 1,')
  })

  it('joins the properties an error prints after its stack', () => {
    const events = parseLines([
      'ERROR: boom',
      '    at a (/x.js:1:1) {',
      "  code: 'E1'",
      '}',
      'next',
    ])
    expect(events).toHaveLength(2)
    expect(events[0].stack).toContain("code: 'E1'")
  })

  it('ends an open object at the next unindented line', () => {
    const events = parseLines(['78 |   if (x) {', '79 |     y()', 'Working 1', 'Sleeping'])
    expect(events.map((e) => e.msg)).toEqual([
      '78 |   if (x) {',
      '79 |     y()',
      'Working 1',
      'Sleeping',
    ])
  })

  it('cuts an object that never closes', () => {
    const open = ['start {', ...Array.from({ length: 150 }, (_, i) => `  f${i}: 1,`)]
    const events = parseLines(open)
    expect(events.length).toBeGreaterThan(1)
    expect(events[0].msg.split('\n')).toHaveLength(MAX_BLOCK_LINES)
  })
})

describe('completeLineCount', () => {
  it('leaves an unclosed trailing object for the next batch', () => {
    expect(completeLineCount(['a', 'b {', '  x: 1,'])).toBe(1)
    expect(completeLineCount(['a', 'b {', '  x: 1,', '}'])).toBe(4)
    expect(completeLineCount(['a', 'b'])).toBe(2)
  })
})
