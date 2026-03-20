#!/usr/bin/env bun
/**
 * logtrail-agent.js
 *
 * Run this on any server whose logs you want to ship to your central logtrail instance.
 * It tails the configured files and POSTs new lines in batches.
 *
 * Usage:
 *   bun agent/logtrail-agent.js
 *   bun agent/logtrail-agent.js --config /path/to/agent.config.yaml
 */

const fs = require('fs')
const path = require('path')
const tailStream = require('tail-stream')

// --- Config loading ---

const args = process.argv.slice(2)
const configFlagIdx = args.indexOf('--config')
const configPath = configFlagIdx >= 0
  ? args[configFlagIdx + 1]
  : path.join(__dirname, 'agent.config.yaml')

let config
try {
  const raw = fs.readFileSync(configPath, 'utf8')
  config = Bun.YAML.parse(raw)
} catch (err) {
  console.error(`[agent] Failed to load config from ${configPath}:`, err.message)
  process.exit(1)
}

const { central_url, agent_secret, app_name, files } = config

if (!central_url || !agent_secret || !app_name || !Array.isArray(files) || !files.length) {
  console.error('[agent] Config must include: central_url, agent_secret, app_name, files[]')
  process.exit(1)
}

// --- Send queue with batching and retry ---

const FLUSH_INTERVAL_MS = 500   // How often to flush buffered lines to central
const MAX_BUFFER_SIZE = 1000    // Drop oldest lines if buffer grows beyond this

let sendQueue = []
let isSending = false
let lastErrorMsg = null         // Track last error to avoid log spam

async function sendBatch(lines) {
  try {
    const res = await fetch(`${central_url}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agent_secret}`,
      },
      body: JSON.stringify({ app: app_name, lines }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${text}`)
    }

    if (lastErrorMsg !== null) {
      console.log('[agent] Reconnected to central server')
      lastErrorMsg = null
    }
    return true
  } catch (err) {
    if (err.message !== lastErrorMsg) {
      console.error('[agent] Failed to send to central:', err.message)
      lastErrorMsg = err.message
    }
    return false
  }
}

async function flush() {
  if (isSending || sendQueue.length === 0) return
  isSending = true

  const batch = sendQueue.splice(0, 200)
  const ok = await sendBatch(batch)

  if (!ok) {
    // Put lines back at the front for retry
    sendQueue.unshift(...batch)

    // Drop oldest lines if buffer is too large
    if (sendQueue.length > MAX_BUFFER_SIZE) {
      const dropped = sendQueue.length - MAX_BUFFER_SIZE
      sendQueue = sendQueue.slice(dropped)
      console.warn(`[agent] Buffer full — dropped ${dropped} oldest lines`)
    }
  }

  isSending = false
}

setInterval(flush, FLUSH_INTERVAL_MS)

// --- File watchers ---

for (const filePath of files) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath)

  console.log(`[agent] Watching: ${absPath}`)

  const ts = tailStream.createReadStream(absPath, {
    beginAt: 'end',       // Only tail new lines, don't replay existing content
    onMove: 'follow',     // Follow the file if it's moved/rotated
    detectTruncate: true, // Handle log truncation (e.g. logrotate)
    endOnError: false,    // Keep trying if the file doesn't exist yet
    encoding: 'utf8',
  })

  ts.on('data', (data) => {
    const lines = data.toString().split('\n').filter((l) => l.trim())
    if (lines.length) sendQueue.push(...lines)
  })

  ts.on('error', (err) => {
    console.error(`[agent] Error on ${absPath}:`, err.message)
  })
}

console.log(`[agent] Running — app: "${app_name}", central: ${central_url}, watching ${files.length} file(s)`)

process.on('SIGINT', () => {
  console.log('[agent] Shutting down...')
  process.exit(0)
})
