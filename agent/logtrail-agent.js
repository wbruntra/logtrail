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

const { central_url, agent_secret, app_name: default_app_name, files } = config

if (!central_url || !agent_secret || !default_app_name || !Array.isArray(files) || !files.length) {
  console.error('[agent] Config must include: central_url, agent_secret, app_name, files[]')
  process.exit(1)
}

// Normalise each file entry to { filePath, appName }
const fileEntries = files.map((entry) => {
  if (typeof entry === 'string') return { filePath: entry, appName: default_app_name }
  if (entry && typeof entry.path === 'string') {
    return { filePath: entry.path, appName: entry.app_name || default_app_name }
  }
  console.error('[agent] Invalid file entry in config:', entry)
  process.exit(1)
})

// --- Send queue with batching and retry (one queue per app) ---

const FLUSH_INTERVAL_MS = 500   // How often to flush buffered lines to central
const MAX_BUFFER_SIZE = 1000    // Drop oldest lines if buffer grows beyond this

// Map of appName -> { queue: string[], isSending: bool, lastErrorMsg: string|null }
const appQueues = {}

function getQueue(appName) {
  if (!appQueues[appName]) {
    appQueues[appName] = { queue: [], isSending: false, lastErrorMsg: null }
  }
  return appQueues[appName]
}

async function sendBatch(appName, lines) {
  const state = getQueue(appName)
  try {
    const res = await fetch(`${central_url}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agent_secret}`,
      },
      body: JSON.stringify({ app: appName, lines }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${text}`)
    }

    if (state.lastErrorMsg !== null) {
      console.log(`[agent] Reconnected to central server (app: ${appName})`)
      state.lastErrorMsg = null
    }
    return true
  } catch (err) {
    if (err.message !== state.lastErrorMsg) {
      console.error(`[agent] Failed to send to central (app: ${appName}):`, err.message)
      state.lastErrorMsg = err.message
    }
    return false
  }
}

async function flush() {
  for (const [appName, state] of Object.entries(appQueues)) {
    if (state.isSending || state.queue.length === 0) continue
    state.isSending = true

    const batch = state.queue.splice(0, 200)
    const ok = await sendBatch(appName, batch)

    if (!ok) {
      // Put lines back at the front for retry
      state.queue.unshift(...batch)

      // Drop oldest lines if buffer is too large
      if (state.queue.length > MAX_BUFFER_SIZE) {
        const dropped = state.queue.length - MAX_BUFFER_SIZE
        state.queue = state.queue.slice(dropped)
        console.warn(`[agent] Buffer full (app: ${appName}) — dropped ${dropped} oldest lines`)
      }
    }

    state.isSending = false
  }
}

setInterval(flush, FLUSH_INTERVAL_MS)

// --- File watchers ---

for (const { filePath, appName } of fileEntries) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath)

  console.log(`[agent] Watching: ${absPath} → app: "${appName}"`)

  // Ensure a queue exists for this app upfront
  getQueue(appName)

  const ts = tailStream.createReadStream(absPath, {
    beginAt: 'end',       // Only tail new lines, don't replay existing content
    onMove: 'follow',     // Follow the file if it's moved/rotated
    detectTruncate: true, // Handle log truncation (e.g. logrotate)
    endOnError: false,    // Keep trying if the file doesn't exist yet
    encoding: 'utf8',
  })

  ts.on('data', (data) => {
    const lines = data.toString().split('\n').filter((l) => l.trim())
    if (lines.length) getQueue(appName).queue.push(...lines)
  })

  ts.on('error', (err) => {
    console.error(`[agent] Error on ${absPath}:`, err.message)
  })
}

const uniqueApps = [...new Set(fileEntries.map((e) => e.appName))]
console.log(`[agent] Running — central: ${central_url}, watching ${fileEntries.length} file(s) across app(s): ${uniqueApps.join(', ')}`)

process.on('SIGINT', () => {
  console.log('[agent] Shutting down...')
  process.exit(0)
})
