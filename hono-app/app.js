const { Hono } = require('hono')
const { createLogger } = require('./middleware/customLogger')

const app = new Hono()

console.log('Starting logtrail application')

// Middleware for logging requests
app.use('*', createLogger())

// Mount the API routes
const appRouter = require('./routes/index.js')
app.route('/api', appRouter)

const logsRouter = require('./routes/logs.js')
app.route('/api/logs', logsRouter)

module.exports = app
