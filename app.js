require('dotenv').config({
  quiet: true,
})
const express = require('express')
const logger = require('morgan')
const path = require('path')
const cookieSession = require('cookie-session')
const secrets = require('./secrets') // Assuming secrets.js is in the same directory


const app = express()

// Middleware for logging requests
app.use(logger('dev'))

app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(
  cookieSession({
    name: 'logtrail-session',
    keys: [secrets.cookieSecret],
    maxAge: 180 * 24 * 60 * 60 * 1000, // 180 days
  }),
)

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
