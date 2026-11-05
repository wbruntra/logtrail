import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

// Legacy file store: ingested-logs/<app>/<YYYY-MM-DD>.log. Ingest writes here and to the
// database until the viewer, search and MCP read from the database; then this file goes.

export const STORE_DIR =
  process.env.LOGTRAIL_INGEST_DIR ?? path.join(process.cwd(), 'ingested-logs')
const RETENTION_DAYS = 3

export interface IngestedLine {
  lineNumber: number
  content: string
}

// Real-time event bus for active SSE stream subscribers.
// Emits 'data:<appName>' with { lineNumber, content } when new lines arrive.
export const ingestEmitter = new EventEmitter()
ingestEmitter.setMaxListeners(100)

function getDateStr(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

// Prevent path traversal from app names
function sanitizeApp(app: string): string {
  return app.replace(/[^a-zA-Z0-9_\-]/g, '_')
}

function getAppDir(app: string): string {
  return path.join(STORE_DIR, sanitizeApp(app))
}

export function getTodayFile(app: string): string {
  return path.join(getAppDir(app), `${getDateStr()}.log`)
}

function ensureAppDir(app: string): void {
  fs.mkdirSync(getAppDir(app), { recursive: true })
}

function append(app: string, contentLines: string[]): void {
  if (!contentLines.length) return
  ensureAppDir(app)
  const totalLines = getAllLines(app).length
  fs.appendFileSync(getTodayFile(app), contentLines.join('\n') + '\n')
  contentLines.forEach((content, i) => {
    ingestEmitter.emit(`data:${sanitizeApp(app)}`, { lineNumber: totalLines + i + 1, content })
  })
}

/** Structured events, one JSON object per line. Each event carries its own ts. */
export function writeEvents(app: string, events: Record<string, unknown>[]): void {
  append(
    app,
    events.map((e) => JSON.stringify(e)),
  )
}

/** Plain lines, prefixed with the ingest timestamp. */
export function writeBatch(app: string, messages: string[]): void {
  const ts = new Date().toISOString()
  append(
    app,
    messages.map((msg) => `${ts} ${msg}`),
  )
}

export function listApps(): string[] {
  try {
    return fs
      .readdirSync(STORE_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

// Returns all log files for an app sorted oldest to newest
export function getAppFiles(app: string): string[] {
  const dir = getAppDir(app)
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.log'))
      .sort() // YYYY-MM-DD.log sorts chronologically
      .map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

// Read all lines across all day files, oldest to newest
export function getAllLines(app: string): string[] {
  const allLines: string[] = []
  for (const file of getAppFiles(app)) {
    try {
      const content = fs.readFileSync(file, 'utf8')
      allLines.push(...content.split('\n').filter((l) => l.trim()))
    } catch {}
  }
  return allLines
}

export function getIngestedHistory(app: string, before: number | undefined, limit = 100) {
  const allLines = getAllLines(app)
  const totalLines = allLines.length

  const endIdx = before !== undefined ? Math.min(before - 1, totalLines) : totalLines
  const startIdx = Math.max(0, endIdx - limit)

  const lines: IngestedLine[] = allLines.slice(startIdx, endIdx).map((content, i) => ({
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

export function searchIngested(
  app: string,
  query: string,
  isRegex: boolean,
  isCaseSensitive: boolean,
): IngestedLine[] | { error: string } {
  const allLines = getAllLines(app)
  let matcher: (line: string) => boolean

  if (isRegex) {
    try {
      const re = new RegExp(query, isCaseSensitive ? '' : 'i')
      matcher = (line) => re.test(line)
    } catch {
      return { error: 'Invalid regex' }
    }
  } else {
    const q = isCaseSensitive ? query : query.toLowerCase()
    matcher = (line) => (isCaseSensitive ? line : line.toLowerCase()).includes(q)
  }

  const results: IngestedLine[] = []
  allLines.forEach((content, i) => {
    if (matcher(content)) results.push({ lineNumber: i + 1, content })
  })
  return results
}

export function getIngestedContext(app: string, targetLine: number, contextLines: number) {
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

export function cleanupOldFiles(): void {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS)
  const cutoffStr = getDateStr(cutoffDate)

  for (const app of listApps()) {
    const dir = getAppDir(app)
    try {
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.log'))) {
        if (file.replace('.log', '') < cutoffStr) {
          fs.unlinkSync(path.join(dir, file))
          console.log(`[ingest] Cleaned up old log: ${app}/${file}`)
        }
      }
    } catch (err) {
      console.error(`[ingest] Cleanup error for ${app}:`, (err as Error).message)
    }
  }
}
