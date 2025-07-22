const express = require('express')
const router = express.Router()
const path = require('path')
const FileWatcher = require('../services/file-watcher')

const logFilePath = path.join(__dirname, '../test/log.txt')
const fileWatcher = new FileWatcher(logFilePath)

router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sendLogData = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  fileWatcher.on('data', sendLogData)

  req.on('close', () => {
    fileWatcher.removeListener('data', sendLogData)
  })
})

module.exports = router
