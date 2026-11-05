import path from 'node:path'
import { requireMcpToken } from '@/hono-app/middleware/auth'
import { getLogConfig } from '@/services/config'
import { getDashboard, getIssue } from '@/services/dashboard'
import { getLogHistory } from '@/services/history-file'
import { getIngestedHistory, listApps } from '@/services/ingest-store'
import { searchLogs } from '@/services/log-search'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { z } from 'zod'

const router = new Hono()
router.use('*', requireMcpToken)

const text = (data: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    },
  ],
})
const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
})

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
        'Summarize errors and warnings from ingested apps: totals, per-app counts, hourly counts, top error codes, issues (recurring errors grouped by fingerprint, with counts, affected users and releases), and the most recent events (with message, request path, status and stack trace). Use get_issue with an issue fingerprint for its stack and occurrences.',
      inputSchema: {
        hours: z.number().int().min(1).max(72).optional().describe('Look-back window (default 24)'),
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
    async ({ hours, levels, limit }) => text(await getDashboard({ hours, levels, limit })),
  )

  server.registerTool(
    'get_issue',
    {
      description:
        'Get one issue (a recurring error or warning) by the fingerprint from get_error_summary: its summary plus its most recent occurrences, each with timestamp, request ID, user, path, status and stack trace.',
      inputSchema: {
        fingerprint: z
          .string()
          .regex(/^[0-9a-f]{16}$/)
          .describe('Issue fingerprint'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Max occurrences, newest first (default 20)'),
      },
    },
    async ({ fingerprint, limit }) => {
      const issue = await getIssue(fingerprint, { limit })
      return issue ? text(issue) : fail(`No issue with fingerprint ${fingerprint}`)
    },
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
        before: z.number().int().min(1).optional().describe('Return lines before this line number'),
      },
    },
    async ({ source, limit = 100, before }) => {
      if (source.startsWith('ingested:')) {
        return text(getIngestedHistory(source.slice('ingested:'.length), before, limit))
      }
      const entry = getLogConfig().find((l: { path: string }) => l.path === source)
      if (!entry) return fail(`Unknown log source: ${source}`)
      const absPath = path.isAbsolute(entry.path)
        ? entry.path
        : path.join(process.cwd(), entry.path)
      try {
        return text(await getLogHistory(absPath, before, limit))
      } catch (err) {
        return fail(`Failed to read log file: ${(err as Error).message}`)
      }
    },
  )

  server.registerTool(
    'search_logs',
    {
      description:
        'Search ingested logs for a substring or regex, across ALL apps by default or one app. Optionally filter by request ID and/or a time window, and return surrounding lines for each match. Returns the newest matches in chronological order, each with app, lineNumber (usable with read_logs "before") and timestamp. At least one of query, reqId, since or until is required.',
      inputSchema: {
        source: z
          .string()
          .optional()
          .describe('Ingested source path, e.g. "ingested:myapp". Omit to search every app.'),
        query: z.string().optional(),
        regex: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        reqId: z.string().optional().describe('Only lines containing this request ID'),
        since: z.string().optional().describe('ISO timestamp, inclusive lower bound'),
        until: z.string().optional().describe('ISO timestamp, inclusive upper bound'),
        context: z
          .number()
          .int()
          .min(0)
          .max(20)
          .optional()
          .describe('Lines of context before and after each match (default 0)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Max matches, newest kept (default 100)'),
      },
    },
    async ({ source, query, reqId, since, until, ...opts }) => {
      if (!query && !reqId && !since && !until) {
        return fail('Provide at least one of query, reqId, since or until')
      }
      if (source && !source.startsWith('ingested:')) {
        return fail(
          'search_logs only supports ingested sources; use read_logs for configured files',
        )
      }
      const result = searchLogs({
        app: source?.slice('ingested:'.length),
        query,
        reqId,
        since,
        until,
        ...opts,
      })
      return result.error ? fail(result.error) : text(result)
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

export default router
