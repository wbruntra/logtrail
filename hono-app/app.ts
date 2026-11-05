import { cleanupOldFiles } from '@/services/ingest-store'
import { Hono } from 'hono'
import { createLogger } from './middleware/customLogger'
import dashboardRouter from './routes/dashboard'
import appRouter from './routes/index.js'
import ingestRouter from './routes/ingest'
import logsRouter from './routes/logs.js'
import mcpRouter from './routes/mcp'

const app = new Hono()

console.log('Starting logtrail application')

// Clean up ingested logs older than 3 days on startup, then daily
cleanupOldFiles()
setInterval(cleanupOldFiles, 24 * 60 * 60 * 1000)

// Middleware for logging requests
app.use('*', createLogger({ ignoredPaths: ['/api/ingest'] }))

// Mount the API routes
app.route('/api', appRouter)
app.route('/api/logs', logsRouter)
app.route('/api/ingest', ingestRouter)
app.route('/api/dashboard', dashboardRouter)
app.route('/api/mcp', mcpRouter)

export default app
