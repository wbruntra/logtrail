import { db } from '@database/db'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import app from '@/hono-app/app'
import secrets from '@/secrets'
import { importApp } from '@/scripts/import-ingested-logs'
import { getRetentionDays } from '@/services/config'
import { insertLines } from '@/services/event-store'
import { retentionCutoff } from '@/services/retention'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'logtrail-phase4-'))

beforeEach(async () => {
  await db.deleteFrom('events').execute()
})

describe('SDK download', () => {
  it('serves the TypeScript source', async () => {
    const res = await app.request('/api/client/logtrail.ts')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(
      fs.readFileSync(path.join(import.meta.dir, '../sdk/logtrail.ts'), 'utf8'),
    )
  })

  it('serves setup instructions as plain text without secrets', async () => {
    const res = await app.request('http://logs.example.com/api/client/setup.md')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toStartWith('text/plain')
    const text = await res.text()
    expect(text).toStartWith('# Connect this project to logtrail')
    expect(text).toContain('http://logs.example.com/api/client/logtrail.ts')
    expect(text).not.toContain(secrets.agentSecret)
  })

  it('serves ESM and CommonJS builds that work', async () => {
    for (const [file, load] of [
      ['logtrail.js', (p: string) => import(p)],
      ['logtrail.cjs', (p: string) => require(p)],
    ] as const) {
      const res = await app.request(`/api/client/${file}`)
      expect(res.headers.get('content-type')).toStartWith('text/javascript')
      const code = await res.text()
      expect(code).toStartWith('/**\n * logtrail.ts')

      const target = path.join(scratch, file)
      fs.writeFileSync(target, code)
      const { createLogtrail } = await load(target)
      const sent: unknown[] = []
      const client = createLogtrail({
        url: 'http://x',
        secret: 's',
        app: 'a',
        fetch: async (_: string, init: RequestInit) => {
          sent.push(JSON.parse(init.body as string))
          return new Response('{}')
        },
      })
      client.log('info', 'hello')
      await client.flush()
      expect(sent).toEqual([{ app: 'a', events: [expect.objectContaining({ msg: 'hello' })] }])
    }
  })
})

describe('retention config', () => {
  const saved = process.env.LOGTRAIL_RETENTION_DAYS
  afterEach(() => {
    if (saved === undefined) delete process.env.LOGTRAIL_RETENTION_DAYS
    else process.env.LOGTRAIL_RETENTION_DAYS = saved
  })

  it('reads LOGTRAIL_RETENTION_DAYS', () => {
    process.env.LOGTRAIL_RETENTION_DAYS = '7'
    expect(getRetentionDays()).toBe(7)
    const now = new Date('2026-11-10T00:00:00.000Z')
    expect(retentionCutoff(now)).toBe('2026-11-03T00:00:00.000Z')
  })
})

describe('import', () => {
  it('skips stored and expired lines, keeping identical lines from one batch', async () => {
    const dir = path.join(scratch, 'web')
    fs.mkdirSync(dir, { recursive: true })
    const now = new Date().toISOString()
    const old = new Date(Date.now() - 10 * 86400_000).toISOString()
    fs.writeFileSync(
      path.join(dir, '2026-11-05.log'),
      [
        `${old} long gone`,
        `${now} ---`,
        `${now} ---`,
        `${now} already here`,
        JSON.stringify({ ts: now, level: 'error', msg: 'boom', code: 'X' }),
        'not a log line',
      ].join('\n') + '\n',
    )
    // As if the new server had already stored this line
    const [stored] = await insertLines('web', ['already here'])
    await db.updateTable('events').set({ ts: now }).where('id', '=', stored.id).execute()

    const cutoff = retentionCutoff()
    await importApp('web', dir, cutoff)
    const msgs = async () =>
      (await db.selectFrom('events').select('msg').where('app', '=', 'web').execute())
        .map((r) => r.msg)
        .sort()
    expect(await msgs()).toEqual(['---', '---', 'already here', 'boom'])

    // A second run imports nothing
    await importApp('web', dir, cutoff)
    expect(await msgs()).toEqual(['---', '---', 'already here', 'boom'])
  })
})
