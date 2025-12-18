const { getLogHistory } = require('../services/history-file')
const express = require('express')
const router = express.Router()
const path = require('path')
const { getLogConfig } = require('../services/config')
const FileWatcher = require('../services/file-watcher')
const { tailFile } = require('../services/tail-file')
const { exec } = require('child_process')
const { promisify } = require('util')
const { getAuthMiddleware } = require('../middleware/auth')

const execAsync = promisify(exec)

// Use authentication middleware
const authMiddleware = getAuthMiddleware()
router.use(authMiddleware)

// Endpoint to get the last N lines of a log file
router.get('/tail', async (req, res) => {
  const fileParam = req.query.file
  const lines = parseInt(req.query.lines, 10) || 100
  const logs = getLogConfig()
  const logEntry = logs.find((l) => l.path === fileParam)
  if (!logEntry) {
    res.status(400).json({ error: 'Invalid log file' })
    return
  }
  const absPath = path.isAbsolute(logEntry.path)
    ? logEntry.path
    : path.join(process.cwd(), logEntry.path)
  try {
    const tailed = await tailFile(absPath, lines)
    res.json({ lines: tailed })
  } catch (err) {
    res.status(500).json({ error: 'Failed to read log file', details: err.message })
  }
})

// Endpoint to get paginated log history (for infinite scroll up)
router.get('/history', async (req, res) => {
  const fileParam = req.query.file
  const before = req.query.before ? parseInt(req.query.before, 10) : undefined
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100
  const logs = getLogConfig()
  const logEntry = logs.find((l) => l.path === fileParam)
  if (!logEntry) {
    res.status(400).json({ error: 'Invalid log file' })
    return
  }
  const absPath = path.isAbsolute(logEntry.path)
    ? logEntry.path
    : path.join(process.cwd(), logEntry.path)
  try {
    const result = await getLogHistory(absPath, before, limit)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Failed to read log file', details: err.message })
  }
})

// Endpoint to list available log files
router.get('/list', (req, res) => {
  const logs = getLogConfig()
  res.json({ logs })
})

// Streaming endpoint for any configured log file
router.get('/stream', (req, res) => {
  const fileParam = req.query.file
  const logs = getLogConfig()
  const logEntry = logs.find((l) => l.path === fileParam)
  if (!logEntry) {
    res.status(400).json({ error: 'Invalid log file' })
    return
  }
  const absPath = path.isAbsolute(logEntry.path)
    ? logEntry.path
    : path.join(process.cwd(), logEntry.path)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // Disable nginx buffering
  res.flushHeaders()

  const fileWatcher = new FileWatcher(absPath)
  const sendLogData = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
  fileWatcher.on('data', sendLogData)

  // Handle client disconnect and errors
  const cleanup = () => {
    fileWatcher.removeListener('data', sendLogData)
    fileWatcher.close() // Properly close the watcher
  }

  req.on('close', cleanup)
  req.on('error', cleanup)
  res.on('error', cleanup)
})

// Search endpoint for log file content
router.get('/search', async (req, res) => {
  const { file, query, regex = 'false', caseSensitive = 'false', limit = '1000' } = req.query
  
  if (!query || !query.trim()) {
    return res.status(400).json({ error: 'Query parameter is required' })
  }
  
  const logs = getLogConfig()
  const logEntry = logs.find((l) => l.path === file)
  if (!logEntry) {
    res.status(400).json({ error: 'Invalid log file' })
    return
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
      // Use regex search with line numbers
      const flags = isCaseSensitive ? '' : '-i'
      grepCommand = `grep -n ${flags} -E "${query.replace(/"/g, '\\"')}" "${absPath}" | head -n ${maxResults}`
    } else {
      // Use literal string search with line numbers
      const flags = isCaseSensitive ? '' : '-i'
      const escapedQuery = query.replace(/'/g, "'\"'\"'") // Escape single quotes for shell
      grepCommand = `grep -n ${flags} -F '${escapedQuery}' "${absPath}" | head -n ${maxResults}`
    }
    
    const { stdout } = await execAsync(grepCommand)
    const lines = stdout.trim().split('\n').filter(line => line)
    
    // Parse grep output (format: lineNumber:content)
    const results = lines.map(line => {
      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) return null
      
      const lineNumber = parseInt(line.substring(0, colonIndex))
      const content = line.substring(colonIndex + 1)
      
      return {
        lineNumber,
        content
      }
    }).filter(Boolean)
    
    res.json({
      query,
      regex: isRegex,
      caseSensitive: isCaseSensitive,
      totalMatches: results.length,
      results: results,
      truncated: results.length >= maxResults
    })
  } catch (error) {
    // If grep finds no matches, it returns exit code 1, which is normal
    if (error.code === 1) {
      res.json({ 
        query, 
        regex: isRegex,
        caseSensitive: isCaseSensitive, 
        totalMatches: 0, 
        results: [],
        truncated: false 
      })
    } else {
      console.error('Search error:', error)
      res.status(500).json({ 
        error: 'Search failed', 
        details: error.message 
      })
    }
  }
})

// Context endpoint - get lines around a specific line number
router.get('/context/:lineNumber', async (req, res) => {
  const { lineNumber } = req.params
  const { file, context = '10' } = req.query
  
  const targetLine = parseInt(lineNumber)
  const contextLines = parseInt(context)
  
  if (isNaN(targetLine) || targetLine < 1) {
    return res.status(400).json({ error: 'Invalid line number' })
  }
  
  if (isNaN(contextLines) || contextLines < 0 || contextLines > 100) {
    return res.status(400).json({ error: 'Context must be between 0 and 100 lines' })
  }
  
  const logs = getLogConfig()
  const logEntry = logs.find((l) => l.path === file)
  if (!logEntry) {
    res.status(400).json({ error: 'Invalid log file' })
    return
  }
  
  const absPath = path.isAbsolute(logEntry.path)
    ? logEntry.path
    : path.join(process.cwd(), logEntry.path)

  try {
    // Get total line count first
    const { stdout: wcOutput } = await execAsync(`wc -l < "${absPath}"`)
    const totalLines = parseInt(wcOutput.trim(), 10)
    
    // Calculate the range
    const startLine = Math.max(1, targetLine - contextLines)
    const endLine = Math.min(totalLines, targetLine + contextLines)
    
    if (targetLine > totalLines) {
      return res.status(404).json({ 
        error: 'Line number exceeds file length',
        totalLines 
      })
    }
    
    // Use sed to extract the specific line range
    const { stdout } = await execAsync(`sed -n '${startLine},${endLine}p' "${absPath}"`)
    
    const lines = stdout.split('\n')
    // Remove the last empty line if it exists
    if (lines[lines.length - 1] === '') {
      lines.pop()
    }
    
    // Create line objects with line numbers and highlight target
    const contextResult = lines.map((content, index) => ({
      lineNumber: startLine + index,
      content: content,
      isTarget: (startLine + index) === targetLine
    }))
    
    res.json({
      targetLine,
      contextLines,
      startLine,
      endLine,
      totalLines,
      lines: contextResult
    })
  } catch (error) {
    console.error('Context error:', error)
    res.status(500).json({ 
      error: 'Failed to get context', 
      details: error.message 
    })
  }
})

module.exports = router
