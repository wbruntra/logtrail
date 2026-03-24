const { Hono } = require('hono')
const { createLogger } = require('./middleware/customLogger')
const { cleanupOldFiles } = require('@/services/ingest-store')

const app = new Hono()

console.log('Starting logtrail application')

// Clean up ingested logs older than 3 days on startup, then daily
cleanupOldFiles()
setInterval(cleanupOldFiles, 24 * 60 * 60 * 1000)

// Middleware for logging requests
app.use('*', createLogger({ ignoredPaths: ['/api/ingest'] }))

// Mount the API routes
const appRouter = require('./routes/index.js')
app.route('/api', appRouter)

const logsRouter = require('./routes/logs.js')
app.route('/api/logs', logsRouter)

const ingestRouter = require('./routes/ingest.js')
app.route('/api/ingest', ingestRouter)

const dashboardRouter = require('./routes/dashboard.js')
app.route('/api/dashboard', dashboardRouter)

module.exports = app
