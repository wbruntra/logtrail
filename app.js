const express = require('express')
const logger = require('morgan')
const cookieSession = require('cookie-session')
const secrets = require('./secrets') // Using existing secrets file

const app = express()

console.log('Starting logtrail application')

// Middleware for logging requests
app.use(logger('dev'))

app.use(express.json())
app.use(express.urlencoded({ extended: false }))

// Session middleware
app.use(
  cookieSession({
    name: 'logtrail-session',
    keys: [secrets.cookieSecret],
    maxAge: 180 * 24 * 60 * 60 * 1000, // 180 days
  }),
)

// Serve static files from client/dist
// const react_client_directory = path.join(__dirname, 'client/dist')
// app.use(express.static(react_client_directory))

// Mount the API routes
const appRouter = require('./routes/index.js')
app.use('/api', appRouter)

const logsRouter = require('./routes/logs.js')
app.use('/api/logs', logsRouter)

module.exports = app
