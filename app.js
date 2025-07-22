const express = require('express')
const cors = require('cors')
const logger = require('morgan')
const path = require('path')

require('dotenv').config()

const app = express()

// Middleware for logging requests
app.use(logger('dev'))

// Middleware
app.use(cors())
app.use(express.json())

const react_client_directory = path.join(__dirname, 'client/dist')

// Add this to verify the directory exists
// Serve static files from client/dist
app.use(express.static(react_client_directory))

// Mount the transcriptions router
const appRouter = require('./routes/index.js')
app.use('/api', appRouter)

const logsRouter = require('./routes/logs.js')
app.use('/api/logs', logsRouter)

// Serve index.html for all unmatched routes (SPA fallback)
app.get('/', (req, res) => {
  res.sendFile(path.join(react_client_directory, 'index.html'))
})

module.exports = app
