const { Hono } = require('hono')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const {
  WebStandardStreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js')
const { z } = require('zod')
const path = require('path')
const { getLogConfig } = require('@/services/config')
const { getLogHistory } = require('@/services/history-file')
const { listApps, getIngestedHistory, searchIngested } = require('@/services/ingest-store')
const { getDashboard } = require('@/services/dashboard')
const { requireMcpToken } = require('@/hono-app/middleware/auth')

const router = new Hono()
router.use('*', requireMcpToken)

const text = (data) => ({
  content: [
    { type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) },
  ],
})
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true })

function createMcpServer() {
  const server = new McpServer({ name: 'logtrail', version: '1.0.0' })

  server.registerTool(
    'list_log_sources',
    {
      description:
        'List available log sources. Use the returned "path" as the "source" argument of read_logs / search_logs. Sources starting with "ingested:" are apps shipping logs to logtrail.',
    },
    async () => {
      const ingested = listApps().map((app) => ({
        name: app,
        path: `ingested:${app}`,
        type: 'ingested',
      }))
      return text({ sources: [...getLogConfig(), ...ingested] })
    },
  )

  server.registerTool(
    'get_error_summary',
    {
      description:
        'Summarize errors and warnings from ingested apps: totals, per-app counts, hourly counts, top error codes, and the most recent events (with message, request path, status and stack trace).',
      inputSchema: {
        hours: z
          .number()
          .int()
          .min(1)
          .max(72)
          .optional()
          .describe('Look-back window (default 24)'),
        levels: z
          .array(z.enum(['error', 'warn']))
          .optional()
          .describe('Levels to include in recentErrors (default both)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Max recent events (default 25)'),
      },
    },
    async ({ hours, levels, limit }) =>
      text(getDashboard({ hours, levels: levels?.join(','), limit })),
  )

  server.registerTool(
    'read_logs',
    {
      description:
        'Read the most recent lines of a log source, paginating backwards. Pass the returned nextBefore as "before" to get older lines.',
      inputSchema: {
        source: z.string().describe('Source path from list_log_sources'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Lines to return (default 100)'),
        before: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Return lines before this line number'),
      },
    },
    async ({ source, limit = 100, before }) => {
      if (source.startsWith('ingested:')) {
        return text(getIngestedHistory(source.slice('ingested:'.length), before, limit))
      }
      const entry = getLogConfig().find((l) => l.path === source)
      if (!entry) return fail(`Unknown log source: ${source}`)
      const absPath = path.isAbsolute(entry.path)
        ? entry.path
        : path.join(process.cwd(), entry.path)
      try {
        return text(await getLogHistory(absPath, before, limit))
      } catch (err) {
        return fail(`Failed to read log file: ${err.message}`)
      }
    },
  )

  server.registerTool(
    'search_logs',
    {
      description:
        'Search an ingested log source for a substring or regex. Returns matching lines with line numbers (usable with read_logs "before").',
      inputSchema: {
        source: z.string().describe('Ingested source path, e.g. "ingested:myapp"'),
        query: z.string().min(1),
        regex: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Max matches, newest kept (default 100)'),
      },
    },
    async ({ source, query, regex = false, caseSensitive = false, limit = 100 }) => {
      if (!source.startsWith('ingested:')) {
        return fail(
          'search_logs only supports ingested sources; use read_logs for configured files',
        )
      }
      const results = searchIngested(source.slice('ingested:'.length), query, regex, caseSensitive)
      if (results.error) return fail(results.error)
      return text({
        totalMatches: results.length,
        truncated: results.length > limit,
        results: results.slice(-limit),
      })
    },
  )

  return server
}

// Stateless streamable-HTTP MCP endpoint: a fresh server/transport per request.
router.all('/', async (c) => {
  const server = createMcpServer()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  return transport.handleRequest(c.req.raw)
})

module.exports = router
