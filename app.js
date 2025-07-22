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
    sameSite: 'lax', // or 'none' if using HTTPS and cross-site
    secure: false, // set to true if using HTTPS
    httpOnly: true,
  }),
)

// Middleware for logging requests
app.use(logger('dev'))
app.use(cors({
  origin: true, // reflect request origin
  credentials: true,
}))
app.use(express.json())

const react_client_directory = path.join(__dirname, 'client/dist')

// Add this to verify the directory exists
// Serve static files from client/dist
app.use(express.static(react_client_directory))

// add a login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body
  if (password === secrets.password) {
    req.session.authenticated = true
    res.status(200).json({ message: 'Login successful', authenticated: true })
  } else {
    res.status(401).json({ error: 'Invalid password', authenticated: false })
  }
})

app.get('/api/status', (req, res) => {
  if (req.session.authenticated) {
    res.status(200).json({ status: 'Authenticated', authenticated: true })
  } else {
    res.status(200).json({ status: 'Unauthenticated', authenticated: false })
  }
})

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
