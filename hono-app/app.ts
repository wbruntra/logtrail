import { Hono } from 'hono'
import { createLogger } from './middleware/customLogger'
import appsRouter from './routes/apps'
import clientRouter from './routes/client'
import dashboardRouter from './routes/dashboard'
import eventsRouter from './routes/events'
import appRouter from './routes/index.js'
import ingestRouter from './routes/ingest'
import issuesRouter from './routes/issues'
import logsRouter from './routes/logs'
import mcpRouter from './routes/mcp'
import { logtrail } from './self-log'

const app = new Hono()

console.log('Starting logtrail application')

// Middleware for logging requests
app.use('*', createLogger({ ignoredPaths: ['/api/ingest'] }))

// Report logtrail's own failed requests to itself
app.use('*', logtrail.hono())

// Mount the API routes
app.route('/api', appRouter)
app.route('/api/logs', logsRouter)
app.route('/api/ingest', ingestRouter)
app.route('/api/dashboard', dashboardRouter)
app.route('/api/mcp', mcpRouter)
app.route('/api/client', clientRouter)
app.route('/api/apps', appsRouter)
app.route('/api/issues', issuesRouter)
app.route('/api/events', eventsRouter)

export default app
