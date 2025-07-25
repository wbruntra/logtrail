const { getLogHistory } = require('../services/history-file')
const express = require('express')
const router = express.Router()
const path = require('path')
const { getLogConfig } = require('../services/config')
const FileWatcher = require('../services/file-watcher')
const { tailFile } = require('../services/tail-file')

// Middleware to check authentication
const requireLogin = (req, res, next) => {
  if (req.session.authenticated) {
    next()
  } else {
    res.status(401).json({ error: 'Unauthorized' })
  }
}

router.use(requireLogin)

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
  res.flushHeaders()

  const fileWatcher = new FileWatcher(absPath)
  const sendLogData = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
  fileWatcher.on('data', sendLogData)

  req.on('close', () => {
    fileWatcher.removeListener('data', sendLogData)
    fileWatcher.removeAllListeners()
  })
})

module.exports = router
