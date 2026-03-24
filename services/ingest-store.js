const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')

const STORE_DIR = path.join(process.cwd(), 'ingested-logs')
const RETENTION_DAYS = 3

// Real-time event bus for active SSE stream subscribers.
// Emits 'data:<appName>' with { lineNumber, content } when new lines arrive.
const ingestEmitter = new EventEmitter()
ingestEmitter.setMaxListeners(100)

function getDateStr(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

// Prevent path traversal from app names
function sanitizeApp(app) {
  return app.replace(/[^a-zA-Z0-9_\-]/g, '_')
}

function getAppDir(app) {
  return path.join(STORE_DIR, sanitizeApp(app))
}

function getTodayFile(app) {
  return path.join(getAppDir(app), `${getDateStr()}.log`)
}

function ensureAppDir(app) {
  fs.mkdirSync(getAppDir(app), { recursive: true })
}

// msgOrEvent: string (legacy plain text) or object (structured event)
function writeEntry(app, msgOrEvent) {
  const ts = new Date().toISOString()
  ensureAppDir(app)
  const totalLines = getAllLines(app).length

  const content =
    typeof msgOrEvent === 'string'
      ? `${ts} ${msgOrEvent}`
      : JSON.stringify({ ts, ...msgOrEvent })

  fs.appendFileSync(getTodayFile(app), content + '\n')
  ingestEmitter.emit(`data:${sanitizeApp(app)}`, { lineNumber: totalLines + 1, content })
  return ts
}

function writeBatch(app, messages) {
  if (!messages.length) return
  ensureAppDir(app)
  const ts = new Date().toISOString()
  const totalLines = getAllLines(app).length
  const contentLines = messages.map((msg) => `${ts} ${msg}`)
  fs.appendFileSync(getTodayFile(app), contentLines.join('\n') + '\n')
  contentLines.forEach((content, i) => {
    ingestEmitter.emit(`data:${sanitizeApp(app)}`, { lineNumber: totalLines + i + 1, content })
  })
}

function listApps() {
  try {
    return fs.readdirSync(STORE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

// Returns all log files for an app sorted oldest to newest
function getAppFiles(app) {
  const dir = getAppDir(app)
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.log'))
      .sort() // YYYY-MM-DD.log sorts chronologically
      .map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

// Read all lines across all day files, oldest to newest
function getAllLines(app) {
  const files = getAppFiles(app)
  const allLines = []
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8')
      const lines = content.split('\n').filter((l) => l.trim())
      allLines.push(...lines)
    } catch {}
  }
  return allLines
}

function getIngestedHistory(app, before, limit = 100) {
  const allLines = getAllLines(app)
  const totalLines = allLines.length

  const endIdx = before !== undefined ? Math.min(before - 1, totalLines) : totalLines
  const startIdx = Math.max(0, endIdx - limit)

  const lines = allLines.slice(startIdx, endIdx).map((content, i) => ({
    lineNumber: startIdx + i + 1,
    content,
  }))

  return {
    lines,
    hasMore: startIdx > 0,
    nextBefore: startIdx > 0 ? startIdx + 1 : null,
    totalLines,
  }
}

function searchIngested(app, query, isRegex, isCaseSensitive) {
  const allLines = getAllLines(app)
  let matcher

  if (isRegex) {
    try {
      const flags = isCaseSensitive ? '' : 'i'
      const re = new RegExp(query, flags)
      matcher = (line) => re.test(line)
    } catch {
      return { error: 'Invalid regex' }
    }
  } else {
    const q = isCaseSensitive ? query : query.toLowerCase()
    matcher = (line) => (isCaseSensitive ? line : line.toLowerCase()).includes(q)
  }

  const results = []
  allLines.forEach((content, i) => {
    if (matcher(content)) {
      results.push({ lineNumber: i + 1, content })
    }
  })
  return results
}

function getIngestedContext(app, targetLine, contextLines) {
  const allLines = getAllLines(app)
  const totalLines = allLines.length

  if (targetLine > totalLines) return null

  const startIdx = Math.max(0, targetLine - 1 - contextLines)
  const endIdx = Math.min(totalLines - 1, targetLine - 1 + contextLines)

  const lines = allLines.slice(startIdx, endIdx + 1).map((content, i) => ({
    lineNumber: startIdx + i + 1,
    content,
    isTarget: startIdx + i + 1 === targetLine,
  }))

  return {
    targetLine,
    contextLines,
    startLine: startIdx + 1,
    endLine: endIdx + 1,
    totalLines,
    lines,
  }
}

function cleanupOldFiles() {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS)
  const cutoffStr = getDateStr(cutoffDate)

  const apps = listApps()
  for (const app of apps) {
    const dir = getAppDir(app)
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.log'))
      for (const file of files) {
        const dateStr = file.replace('.log', '')
        if (dateStr < cutoffStr) {
          fs.unlinkSync(path.join(dir, file))
          console.log(`[ingest] Cleaned up old log: ${app}/${file}`)
        }
      }
    } catch (err) {
      console.error(`[ingest] Cleanup error for ${app}:`, err.message)
    }
  }
}

module.exports = {
  writeEntry,
  writeBatch,
  listApps,
  getAppFiles,
  getTodayFile,
  getAllLines,
  getIngestedHistory,
  searchIngested,
  getIngestedContext,
  cleanupOldFiles,
  ingestEmitter,
  STORE_DIR,
}
