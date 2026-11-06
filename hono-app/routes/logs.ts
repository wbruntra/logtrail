import { exec } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { requireLogin } from '@/hono-app/middleware/auth'
import { getLogConfig } from '@/services/config'
import { getContext, getHistory, getTail, listApps, subscribe } from '@/services/event-query'
import FileWatcher from '@/services/file-watcher'
import { getLogHistory } from '@/services/history-file'
import { searchLogs } from '@/services/log-search'
import { tailFile } from '@/services/tail-file'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { holdOpen } from '@/hono-app/sse'

const execAsync = promisify(exec)

const router = new Hono()

router.use('*', requireLogin)

// Returns the app name if the path is an ingested virtual source, else null
function parseIngested(fileParam: string | undefined): string | null {
  if (fileParam && fileParam.startsWith('ingested:')) {
    return fileParam.slice('ingested:'.length)
  }
  return null
}

// Absolute path of a log file listed in the config, or null if it isn't listed
function configuredPath(fileParam: string | undefined): string | null {
  const logEntry = getLogConfig().find((l) => l.path === fileParam)
  if (!logEntry) return null
  return path.isAbsolute(logEntry.path) ? logEntry.path : path.join(process.cwd(), logEntry.path)
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

// Endpoint to get the last N lines of a log file
router.get('/tail', async (c) => {
  const fileParam = c.req.query('file')
  const lines = parseInt(c.req.query('lines') ?? '', 10) || 100

  const appName = parseIngested(fileParam)
  if (appName !== null) {
    return c.json({ lines: await getTail(appName, lines) })
  }

  const absPath = configuredPath(fileParam)
  if (!absPath) {
    return c.json({ error: 'Invalid log file' }, 400)
  }
  try {
    const tailed = await tailFile(absPath, lines)
    return c.json({ lines: tailed })
  } catch (err) {
    return c.json({ error: 'Failed to read log file', details: errorMessage(err) }, 500)
  }
})

// Endpoint to get paginated log history (for infinite scroll up)
router.get('/history', async (c) => {
  const fileParam = c.req.query('file')
  const beforeParam = c.req.query('before')
  const before = beforeParam ? parseInt(beforeParam, 10) : undefined
  const limit = parseInt(c.req.query('limit') ?? '', 10) || 100

  const appName = parseIngested(fileParam)
  if (appName !== null) {
    return c.json(await getHistory(appName, before, Math.min(limit, 1000)))
  }

  const absPath = configuredPath(fileParam)
  if (!absPath) {
    return c.json({ error: 'Invalid log file' }, 400)
  }
  try {
    const result = await getLogHistory(absPath, before, limit)
    return c.json(result)
  } catch (err) {
    return c.json({ error: 'Failed to read log file', details: errorMessage(err) }, 500)
  }
})

// Endpoint to list available log files (configured + ingested)
router.get('/list', async (c) => {
  const configuredLogs = getLogConfig()

  const ingestedLogs = (await listApps()).map((appName) => ({
    name: appName,
    path: `ingested:${appName}`,
    type: 'ingested',
    description: `Ingested via agent`,
    enabled: true,
  }))

  return c.json({ logs: [...configuredLogs, ...ingestedLogs] })
})

// Streaming endpoint for any configured log file or ingested app
router.get('/stream', (c) => {
  const fileParam = c.req.query('file')

  c.header('X-Accel-Buffering', 'no') // Disable nginx buffering

  const appName = parseIngested(fileParam)
  if (appName !== null) {
    return streamSSE(c, async (stream) => {
      const unsubscribe = subscribe(appName, (line) => {
        stream.writeSSE({ data: JSON.stringify(line) })
      })
      await holdOpen(stream, unsubscribe)
    })
  }

  const absPath = configuredPath(fileParam)
  if (!absPath) {
    return c.json({ error: 'Invalid log file' }, 400)
  }

  return streamSSE(c, async (stream) => {
    const fileWatcher = new FileWatcher(absPath)
    const sendLogData = (data: unknown) => {
      stream.writeSSE({ data: JSON.stringify(data) })
    }
    fileWatcher.on('data', sendLogData)
    await holdOpen(stream, () => {
      fileWatcher.removeListener('data', sendLogData)
      fileWatcher.close()
    })
  })
})

// Search endpoint for log file content
router.get('/search', async (c) => {
  const file = c.req.query('file')
  const query = c.req.query('query')
  const isRegex = c.req.query('regex') === 'true'
  const isCaseSensitive = c.req.query('caseSensitive') === 'true'
  const maxResults = Math.min(parseInt(c.req.query('limit') ?? '1000', 10) || 1000, 10000)

  if (!query || !query.trim()) {
    return c.json({ error: 'Query parameter is required' }, 400)
  }

  const appName = parseIngested(file)
  if (appName !== null) {
    const result = await searchLogs({
      app: appName,
      query,
      regex: isRegex,
      caseSensitive: isCaseSensitive,
      limit: maxResults,
    })
    if ('error' in result) {
      return c.json({ error: result.error }, 400)
    }
    return c.json({
      query,
      regex: isRegex,
      caseSensitive: isCaseSensitive,
      totalMatches: result.totalMatches,
      results: result.results.map(({ lineNumber, content }) => ({ lineNumber, content })),
      truncated: result.truncated,
    })
  }

  const absPath = configuredPath(file)
  if (!absPath) {
    return c.json({ error: 'Invalid log file' }, 400)
  }

  try {
    const flags = isCaseSensitive ? '' : '-i'
    const grepCommand = isRegex
      ? `grep -n ${flags} -E "${query.replace(/"/g, '\\"')}" "${absPath}" | head -n ${maxResults}`
      : `grep -n ${flags} -F '${query.replace(/'/g, "'\"'\"'")}' "${absPath}" | head -n ${maxResults}`

    const { stdout } = await execAsync(grepCommand)

    // Parse grep output (format: lineNumber:content)
    const results = stdout
      .trim()
      .split('\n')
      .filter((line) => line)
      .flatMap((line) => {
        const colonIndex = line.indexOf(':')
        if (colonIndex === -1) return []
        return [
          {
            lineNumber: parseInt(line.substring(0, colonIndex), 10),
            content: line.substring(colonIndex + 1),
          },
        ]
      })

    return c.json({
      query,
      regex: isRegex,
      caseSensitive: isCaseSensitive,
      totalMatches: results.length,
      results,
      truncated: results.length >= maxResults,
    })
  } catch (error) {
    // grep returns exit code 1 when no matches found — that's normal
    if ((error as { code?: number }).code === 1) {
      return c.json({
        query,
        regex: isRegex,
        caseSensitive: isCaseSensitive,
        totalMatches: 0,
        results: [],
        truncated: false,
      })
    }
    console.error('Search error:', error)
    return c.json({ error: 'Search failed', details: errorMessage(error) }, 500)
  }
})

// Context endpoint - get lines around a specific line number
router.get('/context/:lineNumber', async (c) => {
  const file = c.req.query('file')
  const targetLine = parseInt(c.req.param('lineNumber'), 10)
  const contextLines = parseInt(c.req.query('context') ?? '10', 10)

  if (isNaN(targetLine) || targetLine < 1) {
    return c.json({ error: 'Invalid line number' }, 400)
  }

  if (isNaN(contextLines) || contextLines < 0 || contextLines > 100) {
    return c.json({ error: 'Context must be between 0 and 100 lines' }, 400)
  }

  const appName = parseIngested(file)
  if (appName !== null) {
    const result = await getContext(appName, targetLine, contextLines)
    if (!result) {
      return c.json({ error: 'Line not found (it may have expired)' }, 404)
    }
    return c.json(result)
  }

  const absPath = configuredPath(file)
  if (!absPath) {
    return c.json({ error: 'Invalid log file' }, 400)
  }

  try {
    const { stdout: wcOutput } = await execAsync(`wc -l < "${absPath}"`)
    const totalLines = parseInt(wcOutput.trim(), 10)

    const startLine = Math.max(1, targetLine - contextLines)
    const endLine = Math.min(totalLines, targetLine + contextLines)

    if (targetLine > totalLines) {
      return c.json({ error: 'Line number exceeds file length', totalLines }, 404)
    }

    const { stdout } = await execAsync(`sed -n '${startLine},${endLine}p' "${absPath}"`)

    const lines = stdout.split('\n')
    if (lines[lines.length - 1] === '') {
      lines.pop()
    }

    return c.json({
      targetLine,
      contextLines,
      startLine,
      endLine,
      totalLines,
      lines: lines.map((content, index) => ({
        lineNumber: startLine + index,
        content,
        isTarget: startLine + index === targetLine,
      })),
    })
  } catch (error) {
    console.error('Context error:', error)
    return c.json({ error: 'Failed to get context', details: errorMessage(error) }, 500)
  }
})

export default router
