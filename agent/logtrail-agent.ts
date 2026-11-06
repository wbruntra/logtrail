#!/usr/bin/env bun
/**
 * logtrail-agent.ts — ships the contents of log files to logtrail.
 *
 * For output no SDK can see: morgan, pino, pm2 logs, cron scripts. Run it on the
 * machine that holds the files. Each file is tagged with the app, service and env it
 * belongs to, and logtrail parses the lines into events (JSON loggers, morgan access
 * lines and plain text are recognised).
 *
 *   bun agent/logtrail-agent.ts [--config /path/to/agent.config.yaml]
 *
 * See agent/agent.config.example.yaml. The secret is read from LOGTRAIL_SECRET, or
 * agent_secret in the config.
 */

import fs from 'node:fs'
import path from 'node:path'
// @ts-expect-error tail-stream ships no types
import tailStream from 'tail-stream'

interface Tags {
  app: string
  service: string
  env: string
}

interface FileEntry extends Tags {
  filePath: string
  /** false when the app reports its errors itself: access lines stay debug events */
  requestAlerts: boolean
}

const args = process.argv.slice(2)
const flag = args.indexOf('--config')
const configPath = flag >= 0 ? args[flag + 1] : path.join(import.meta.dir, 'agent.config.yaml')

function fail(message: string): never {
  console.error(`[agent] ${message}`)
  process.exit(1)
}

let config: Record<string, any>
try {
  config = Bun.YAML.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, any>
} catch (err) {
  fail(`Failed to load config from ${configPath}: ${(err as Error).message}`)
}

const centralUrl = String(config.central_url ?? '').replace(/\/+$/, '')
const secret = process.env.LOGTRAIL_SECRET || config.agent_secret
if (!centralUrl || !secret) fail('Set central_url, and LOGTRAIL_SECRET (or agent_secret)')
if (!Array.isArray(config.files) || !config.files.length) fail('Config needs a files list')

// Top-level app, service and env are defaults for every file
const defaults = {
  app: config.app as string | undefined,
  service: config.service as string | undefined,
  env: (config.env as string | undefined) ?? 'production',
}

const entries: FileEntry[] = config.files.map((entry: unknown) => {
  const e = typeof entry === 'string' ? { path: entry } : (entry as Record<string, any>)
  if (!e || typeof e.path !== 'string') fail(`Invalid file entry: ${JSON.stringify(entry)}`)
  const app = e.app ?? defaults.app
  if (!app) fail(`No app for ${e.path}: set app on the file or at the top of the config`)
  return {
    filePath: e.path,
    app,
    service: e.service ?? defaults.service ?? app,
    env: e.env ?? defaults.env,
    requestAlerts: (e.request_alerts ?? config.request_alerts) !== false,
  }
})

// --- Send queue with batching and retry, one per file ---

const FLUSH_INTERVAL_MS = 500
const MAX_BUFFER_SIZE = 5000
const BATCH_LINES = 200

interface Queue extends Tags {
  requestAlerts: boolean
  file: string
  lines: string[]
  sending: boolean
  lastError: string | null
}

const queues: Queue[] = []

async function send(q: Queue, lines: string[]): Promise<boolean> {
  try {
    const res = await fetch(`${centralUrl}/api/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        app: q.app,
        service: q.service,
        env: q.env,
        file: q.file,
        requestAlerts: q.requestAlerts,
        lines,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`)
    if (q.lastError !== null) console.log(`[agent] Reconnected (${q.file})`)
    q.lastError = null
    return true
  } catch (err) {
    const message = (err as Error).message
    if (message !== q.lastError) console.error(`[agent] Failed to send ${q.file}: ${message}`)
    q.lastError = message
    return false
  }
}

async function flush(): Promise<void> {
  for (const q of queues) {
    if (q.sending || !q.lines.length) continue
    q.sending = true
    const batch = q.lines.splice(0, BATCH_LINES)
    if (!(await send(q, batch))) {
      q.lines.unshift(...batch)
      if (q.lines.length > MAX_BUFFER_SIZE) {
        const dropped = q.lines.length - MAX_BUFFER_SIZE
        q.lines = q.lines.slice(dropped)
        console.warn(`[agent] Buffer full (${q.file}): dropped ${dropped} oldest lines`)
      }
    }
    q.sending = false
  }
}

setInterval(flush, FLUSH_INTERVAL_MS)

// --- File watchers ---

for (const { filePath, ...tags } of entries) {
  const absPath = path.resolve(filePath)
  const q: Queue = {
    ...tags,
    file: path.basename(absPath),
    lines: [],
    sending: false,
    lastError: null,
  }
  queues.push(q)
  console.log(`[agent] ${absPath} -> ${tags.app} / ${tags.service} (${tags.env})`)

  const stream = tailStream.createReadStream(absPath, {
    beginAt: 'end', // only new lines, never a replay
    onMove: 'follow', // follow rotation
    detectTruncate: true,
    endOnError: false, // keep waiting if the file doesn't exist yet
    encoding: 'utf8',
  })

  // A chunk can end mid-line; hold the tail back until its newline arrives
  let partial = ''
  stream.on('data', (data: Buffer | string) => {
    const parts = (partial + data.toString()).split('\n')
    partial = parts.pop() ?? ''
    for (const line of parts) if (line.trim()) q.lines.push(line)
  })
  stream.on('error', (err: Error) => console.error(`[agent] Error on ${absPath}: ${err.message}`))
}

process.on('SIGINT', () => {
  console.log('[agent] Shutting down...')
  process.exit(0)
})
