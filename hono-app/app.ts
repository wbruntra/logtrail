import { Hono } from 'hono'
import { createLogger } from './middleware/customLogger'
import clientRouter from './routes/client'
import dashboardRouter from './routes/dashboard'
import appRouter from './routes/index.js'
import ingestRouter from './routes/ingest'
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

export default app
