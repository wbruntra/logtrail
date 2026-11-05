#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const baseUrl = (process.env.LOGTRAIL_URL || 'https://logtrail2.lunaparkdigital.com').replace(
  /\/$/,
  '',
)
const outputDir = path.resolve(
  process.env.LOGTRAIL_OUTPUT_DIR || path.join(process.cwd(), 'data', 'raw-logs'),
)
const pageSize = Math.min(
  Math.max(parseInt(process.env.LOGTRAIL_PAGE_SIZE || '500', 10) || 500, 1),
  1000,
)
const includeAll = process.env.LOGTRAIL_INCLUDE_ALL === 'true'
const errorQuery =
  'ERROR|FATAL|CRITICAL|"level":"error"| (GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) [^ ]+ 5[0-9][0-9] '

function getPassword() {
  if (process.env.LOGTRAIL_PASSWORD) return process.env.LOGTRAIL_PASSWORD
  try {
    return require(path.join(process.cwd(), 'secrets.js')).password
  } catch {
    throw new Error('Set LOGTRAIL_PASSWORD or provide a local secrets.js file')
  }
}

function safeName(value) {
  return value.replace(/^ingested:/, 'ingested-').replace(/[^a-zA-Z0-9._-]+/g, '_')
}

// Keep error detection aligned with client/src/utils/logParser.ts:
// explicit ERROR/FATAL/CRITICAL markers, or HTTP 5xx request lines.
function isErrorLine(content) {
  if (/\b(ERROR|FATAL|CRITICAL)\b/i.test(content)) return true
  return /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+[^\s]+\s+5\d{2}\s+(?:\d+\.\d+\s+ms|-)/.test(
    content,
  )
}

function isStructuredError(content) {
  if (!content.startsWith('{')) return false
  try {
    const event = JSON.parse(content)
    return event && event.level === 'error'
  } catch {
    return false
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  let body
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${body?.error || 'request failed'}`)
  }
  return body
}

async function login() {
  const body = await requestJson(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: getPassword() }),
  })
  if (!body?.token) throw new Error('Login succeeded but no token was returned')
  return body.token
}

async function downloadLog(log, token) {
  const headers = { Authorization: `Bearer ${token}` }
  if (!includeAll) {
    const params = new URLSearchParams({
      file: log.path,
      query: errorQuery,
      regex: 'true',
      caseSensitive: 'false',
      limit: '10000',
    })
    const result = await requestJson(`${baseUrl}/api/logs/search?${params}`, { headers })
    return { lines: result.results || [], totalLines: result.totalMatches || 0 }
  }

  const lines = []
  let before

  while (true) {
    const params = new URLSearchParams({ file: log.path, limit: String(pageSize) })
    if (before !== undefined) params.set('before', String(before))
    const page = await requestJson(`${baseUrl}/api/logs/history?${params}`, { headers })
    if (!Array.isArray(page.lines)) throw new Error(`Unexpected history response for ${log.path}`)
    lines.unshift(...page.lines)
    if (!page.hasMore || !page.nextBefore) {
      return { lines, totalLines: page.totalLines }
    }
    before = page.nextBefore
  }
}

async function main() {
  const token = await login()
  const inventory = await requestJson(`${baseUrl}/api/logs/list`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!Array.isArray(inventory.logs)) throw new Error('Unexpected log inventory response')

  fs.mkdirSync(outputDir, { recursive: true })
  const manifest = {
    downloadedAt: new Date().toISOString(),
    source: baseUrl,
    pageSize,
    logs: [],
  }

  for (const log of inventory.logs) {
    console.log(`Reading ${log.path}...`)
    const result = await downloadLog(log, token)
    const fileName = `${safeName(log.path)}.jsonl`
    const destination = path.join(outputDir, fileName)
    const selectedLines = includeAll
      ? result.lines
      : result.lines.filter((line) => isStructuredError(line.content) || isErrorLine(line.content))
    const content = selectedLines
      .map((line) =>
        JSON.stringify({
          source: log,
          lineNumber: line.lineNumber,
          content: line.content,
        }),
      )
      .join('\n')
    fs.writeFileSync(destination, content ? `${content}\n` : '')
    manifest.logs.push({
      ...log,
      file: fileName,
      totalLines: result.totalLines,
      selectedLines: selectedLines.length,
    })
    console.log(
      `${log.path}: ${selectedLines.length}/${result.totalLines} error lines -> ${fileName}`,
    )
  }

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(
    `${includeAll ? 'Downloaded all lines' : 'Downloaded error lines'} from ${manifest.logs.length} logs to ${outputDir}`,
  )
}

main().catch((error) => {
  console.error(`Download failed: ${error.message}`)
  process.exitCode = 1
})
