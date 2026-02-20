const { Hono } = require('hono')
const customLogger = require('./middleware/customLogger').default

const app = new Hono()

console.log('Starting logtrail application')

// Middleware for logging requests
app.use('*', customLogger)

// Mount the API routes
const appRouter = require('./routes/index.js')
app.route('/api', appRouter)

const logsRouter = require('./routes/logs.js')
app.route('/api/logs', logsRouter)

module.exports = app
