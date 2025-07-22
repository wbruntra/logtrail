const express = require('express')
const cors = require('cors')
const logger = require('morgan')
const path = require('path')
const cookieSession = require('cookie-session')
const secrets = require('./secrets') // Assuming secrets.js is in the same directory

require('dotenv').config()

const app = express()

// Session cookie middleware
app.use(
  cookieSession({
    name: 'logtrail-session',
    keys: [secrets.sessionSecret],
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  }),
)

// Middleware for logging requests
app.use(logger('dev'))

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
