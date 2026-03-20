const { Hono } = require('hono')
const { streamSSE } = require('hono/streaming')
const path = require('path')
const { getLogHistory } = require('@/services/history-file')
const { getLogConfig } = require('@/services/config')
const FileWatcher = require('@/services/file-watcher')
const { tailFile } = require('@/services/tail-file')
const {
  listApps,
  getTodayFile,
  getAllLines,
  getIngestedHistory,
  searchIngested,
  getIngestedContext,
  ingestEmitter,
} = require('@/services/ingest-store')
const { exec } = require('child_process')
const { promisify } = require('util')
const { getAuthMiddleware } = require('@/hono-app/middleware/auth')

const execAsync = promisify(exec)

const router = new Hono()

// Use authentication middleware
const authMiddleware = getAuthMiddleware()
router.use('*', authMiddleware)

// Returns the app name if the path is an ingested virtual source, else null
function parseIngested(fileParam) {
  if (fileParam && fileParam.startsWith('ingested:')) {
    return fileParam.slice('ingested:'.length)
  }
  return null
}

// Endpoint to get the last N lines of a log file
router.get('/tail', async (c) => {
  const fileParam = c.req.query('file')
  const lines = parseInt(c.req.query('lines'), 10) || 100

  const appName = parseIngested(fileParam)
  if (appName !== null) {
    const todayFile = getTodayFile(appName)
    try {
      const tailed = await tailFile(todayFile, lines)
      return c.json({ lines: tailed })
    } catch (err) {
      return c.json({ error: 'Failed to read ingested log', details: err.message }, 500)
    }
  }

  const logs = getLogConfig()
  const logEntry = logs.find((l) => l.path === fileParam)
  if (!logEntry) {
    return c.json({ error: 'Invalid log file' }, 400)
  }
  const absPath = path.isAbsolute(logEntry.path)
    ? logEntry.path
    : path.join(process.cwd(), logEntry.path)
  try {
    const tailed = await tailFile(absPath, lines)
    return c.json({ lines: tailed })
  } catch (err) {
    return c.json({ error: 'Failed to read log file', details: err.message }, 500)
  }
})

// Endpoint to get paginated log history (for infinite scroll up)
router.get('/history', async (c) => {
  const fileParam = c.req.query('file')
  const before = c.req.query('before') ? parseInt(c.req.query('before'), 10) : undefined
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit'), 10) : 100

  const appName = parseIngested(fileParam)
  if (appName !== null) {
    const result = getIngestedHistory(appName, before, limit)
    return c.json(result)
  }

  const logs = getLogConfig()
  const logEntry = logs.find((l) => l.path === fileParam)
  if (!logEntry) {
    return c.json({ error: 'Invalid log file' }, 400)
  }
  const absPath = path.isAbsolute(logEntry.path)
    ? logEntry.path
    : path.join(process.cwd(), logEntry.path)
  try {
    const result = await getLogHistory(absPath, before, limit)
    return c.json(result)
  } catch (err) {
    return c.json({ error: 'Failed to read log file', details: err.message }, 500)
  }
})

// Endpoint to list available log files (configured + ingested)
router.get('/list', (c) => {
  const configuredLogs = getLogConfig()

  const ingestedLogs = listApps().map((appName) => ({
    name: appName,
    path: `ingested:${appName}`,
    type: 'ingested',
    description: `Ingested via agent`,
    enabled: true,
  }))

  return c.json({ logs: [...configuredLogs, ...ingestedLogs] })
})

// Streaming endpoint for any configured log file
router.get('/stream', (c) => {
  const fileParam = c.req.query('file')

  c.header('X-Accel-Buffering', 'no') // Disable nginx buffering

  const appName = parseIngested(fileParam)

  // Ingested logs: subscribe to the in-process EventEmitter instead of file watching.
  // appendFileSync writes don't reliably trigger fs.watch events in Bun.
  if (appName !== null) {
    return streamSSE(c, async (stream) => {
      const handler = (data) => {
        stream.writeSSE({ data: JSON.stringify(data) })
      }
      ingestEmitter.on(`data:${appName}`, handler)

      const heartbeatInterval = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: 'heartbeat' })
      }, 15000)

      await new Promise((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeatInterval)
          ingestEmitter.off(`data:${appName}`, handler)
          resolve()
        })
      })
    })
  }

  const logs = getLogConfig()
  const logEntry = logs.find((l) => l.path === fileParam)
  if (!logEntry) {
    return c.json({ error: 'Invalid log file' }, 400)
  }
  const absPath = path.isAbsolute(logEntry.path)
    ? logEntry.path
    : path.join(process.cwd(), logEntry.path)

  return streamSSE(c, async (stream) => {
    const fileWatcher = new FileWatcher(absPath)
    const sendLogData = (data) => {
      stream.writeSSE({ data: JSON.stringify(data) })
    }
    fileWatcher.on('data', sendLogData)

    // Send a heartbeat every 15 seconds to keep intermediate proxies/load balancers alive
    const heartbeatInterval = setInterval(() => {
      stream.writeSSE({ event: 'ping', data: 'heartbeat' })
    }, 15000)

    await new Promise((resolve) => {
      stream.onAbort(() => {
        clearInterval(heartbeatInterval)
        fileWatcher.removeListener('data', sendLogData)
        fileWatcher.close()
        resolve()
      })
    })
  })
})

// Search endpoint for log file content
router.get('/search', async (c) => {
  const file = c.req.query('file')
  const query = c.req.query('query')
  const regex = c.req.query('regex') ?? 'false'
  const caseSensitive = c.req.query('caseSensitive') ?? 'false'
  const limit = c.req.query('limit') ?? '1000'

  if (!query || !query.trim()) {
    return c.json({ error: 'Query parameter is required' }, 400)
  }

  const appName = parseIngested(file)
  if (appName !== null) {
    const isRegex = regex === 'true'
    const isCaseSensitive = caseSensitive === 'true'
    const maxResults = Math.min(parseInt(limit), 10000)

    const results = searchIngested(appName, query, isRegex, isCaseSensitive)
    if (results.error) {
      return c.json({ error: results.error }, 400)
    }
    const truncated = results.length > maxResults
    return c.json({
      query,
      regex: isRegex,
      caseSensitive: isCaseSensitive,
      totalMatches: Math.min(results.length, maxResults),
      results: results.slice(0, maxResults),
      truncated,
    })
  }

  const logs = getLogConfig()
  const logEntry = logs.find((l) => l.path === file)
  if (!logEntry) {
    return c.json({ error: 'Invalid log file' }, 400)
  }

  const absPath = path.isAbsolute(logEntry.path)
    ? logEntry.path
    : path.join(process.cwd(), logEntry.path)

  try {
    let grepCommand
    const isRegex = regex === 'true'
    const isCaseSensitive = caseSensitive === 'true'
    const maxResults = Math.min(parseInt(limit), 10000) // Cap at 10k results

    if (isRegex) {
      const flags = isCaseSensitive ? '' : '-i'
      grepCommand = `grep -n ${flags} -E "${query.replace(
        /"/g,
        '\\"',
      )}" "${absPath}" | head -n ${maxResults}`
    } else {
      const flags = isCaseSensitive ? '' : '-i'
      const escapedQuery = query.replace(/'/g, "'\"'\"'")
      grepCommand = `grep -n ${flags} -F '${escapedQuery}' "${absPath}" | head -n ${maxResults}`
    }

    const { stdout } = await execAsync(grepCommand)
    const lines = stdout
      .trim()
      .split('\n')
      .filter((line) => line)

    // Parse grep output (format: lineNumber:content)
    const results = lines
      .map((line) => {
        const colonIndex = line.indexOf(':')
        if (colonIndex === -1) return null
        const lineNumber = parseInt(line.substring(0, colonIndex))
        const content = line.substring(colonIndex + 1)
        return { lineNumber, content }
      })
      .filter(Boolean)

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
    if (error.code === 1) {
      return c.json({
        query,
        regex: regex === 'true',
        caseSensitive: caseSensitive === 'true',
        totalMatches: 0,
        results: [],
        truncated: false,
      })
    }
    console.error('Search error:', error)
    return c.json({ error: 'Search failed', details: error.message }, 500)
  }
})

// Context endpoint - get lines around a specific line number
router.get('/context/:lineNumber', async (c) => {
  const lineNumber = c.req.param('lineNumber')
  const file = c.req.query('file')
  const context = c.req.query('context') ?? '10'

  const targetLine = parseInt(lineNumber)
  const contextLines = parseInt(context)

  if (isNaN(targetLine) || targetLine < 1) {
    return c.json({ error: 'Invalid line number' }, 400)
  }

  if (isNaN(contextLines) || contextLines < 0 || contextLines > 100) {
    return c.json({ error: 'Context must be between 0 and 100 lines' }, 400)
  }

  const appName = parseIngested(file)
  if (appName !== null) {
    const result = getIngestedContext(appName, targetLine, contextLines)
    if (!result) {
      return c.json({ error: 'Line number exceeds log length' }, 404)
    }
    return c.json(result)
  }

  const logs = getLogConfig()
  const logEntry = logs.find((l) => l.path === file)
  if (!logEntry) {
    return c.json({ error: 'Invalid log file' }, 400)
  }

  const absPath = path.isAbsolute(logEntry.path)
    ? logEntry.path
    : path.join(process.cwd(), logEntry.path)

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

    const contextResult = lines.map((content, index) => ({
      lineNumber: startLine + index,
      content,
      isTarget: startLine + index === targetLine,
    }))

    return c.json({
      targetLine,
      contextLines,
      startLine,
      endLine,
      totalLines,
      lines: contextResult,
    })
  } catch (error) {
    console.error('Context error:', error)
    return c.json({ error: 'Failed to get context', details: error.message }, 500)
  }
})

module.exports = router
