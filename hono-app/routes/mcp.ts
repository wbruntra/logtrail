import path from 'node:path'
import { requireMcpToken } from '@/hono-app/middleware/auth'
import { getLogConfig } from '@/services/config'
import { LEVELS } from '@database/schema'
import { getDashboard } from '@/services/dashboard'
import { appStats, getHistory } from '@/services/event-query'
import { getLogHistory } from '@/services/history-file'
import { getIssueDetail, issueSummaries, setIssueState } from '@/services/issues'
import { GROUP_BY_FIELDS, countEvents, searchEvents } from '@/services/log-search'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { z } from 'zod'

const router = new Hono()
router.use('*', requireMcpToken)

// Compact JSON: these results go into an agent's context
const text = (data: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: typeof data === 'string' ? data : JSON.stringify(data),
    },
  ],
})
const fail = (message: string) => ({
  content: [{ type: 'text' as const, text: message }],
  isError: true,
})

/** "ingested:myapp" or "myapp" -> "myapp" */
const appOf = (source: string | undefined) => source?.replace(/^ingested:/, '') || undefined

const noRelease = (app: string) =>
  `${app} reported no release; set GIT_SHA (or the SDK's release option) to tell deploys apart`

const LEVEL_FILTERS = [...LEVELS, 'none'] as const

const envParam = z
  .string()
  .optional()
  .describe('Only this environment, e.g. "production" or "staging". Omit for every environment.')
const serviceParam = z
  .string()
  .optional()
  .describe(
    'Only this service (process) of the app, e.g. "tpp-auth". Services are listed by list_log_sources.',
  )

const extraParam = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe(
    'Match fields the app sent beyond the standard ones (they appear in an event\'s "extra"), all of which must equal these, e.g. {"platform":"instagram_direct","step":"FETCH_MEDIA"}',
  )

function createMcpServer() {
  const server = new McpServer({ name: 'logtrail', version: '1.2.0' })

  server.registerTool(
    'list_log_sources',
    {
      description:
        'List available log sources. Use the returned "path" as the "source" argument of read_logs / search_logs / get_error_summary. Sources starting with "ingested:" are apps (a product or codebase) sending events to logtrail, with retained event counts, first/last event times, the "services" (processes) within the app and the "envs" they send from. Pass a service or env to the other tools to narrow to one. "kind" is "sdk" for structured events (levels, routes, statuses), "lines" for plain text lines kept from before logtrail required structured events, or "mixed".',
    },
    async () => {
      const stats = await appStats()
      const ingested = stats.map(({ app, structured, unstructured, ...rest }) => ({
        name: app,
        path: `ingested:${app}`,
        type: 'ingested',
        kind: !unstructured ? 'sdk' : !structured ? 'lines' : 'mixed',
        ...rest,
      }))
      return text({ sources: [...getLogConfig(), ...ingested] })
    },
  )

  server.registerTool(
    'get_error_summary',
    {
      description:
        'Summarize errors and warnings from ingested apps over a window: totals, per-app counts, hourly counts, top error codes, issues (recurring errors grouped by fingerprint) and the most recent events. In issues, count and users cover the window only; firstSeen is the earliest occurrence retained at any time. Muted issues, and resolved ones that have not recurred, are left out unless includeTriaged is true; hide noise with set_issue_state. Recent events omit stack traces unless stacks is true; drill into an issue with get_issue(fingerprint) for its stack, breakdowns by path/status/release/user, and occurrences.',
      inputSchema: {
        source: z
          .string()
          .optional()
          .describe('One app, e.g. "ingested:myapp" or "myapp". Omit for every app.'),
        service: serviceParam,
        env: envParam,
        hours: z.number().int().min(1).max(72).optional().describe('Look-back window (default 24)'),
        levels: z
          .array(z.enum(['error', 'warn']))
          .optional()
          .describe('Levels to include in issues and recentErrors (default both)'),
        issues: z
          .number()
          .int()
          .min(0)
          .max(250)
          .optional()
          .describe('Max issues (default 20), in the order given by sort'),
        sort: z
          .enum(['recent', 'count'])
          .optional()
          .describe('Order issues by most recently seen (default) or by most occurrences'),
        release: z
          .string()
          .optional()
          .describe('Only events from this release, e.g. to see what a deploy broke'),
        newOnly: z
          .boolean()
          .optional()
          .describe('Only issues first seen inside the window (default false)'),
        includeTriaged: z
          .boolean()
          .optional()
          .describe('Also include muted and resolved issues (default false)'),
        limit: z
          .number()
          .int()
          .min(0)
          .max(200)
          .optional()
          .describe('Max recent events (default 10)'),
        stacks: z
          .boolean()
          .optional()
          .describe('Include stack traces in recent events (default false)'),
      },
    },
    async ({
      source,
      service,
      env,
      hours,
      levels,
      issues = 20,
      sort,
      release,
      newOnly,
      includeTriaged = false,
      limit = 10,
      stacks = false,
    }) => {
      const app = appOf(source)
      const summary = await getDashboard({
        app,
        service,
        env,
        hours,
        levels,
        stacks,
        release,
        sort,
        newOnly,
        hideTriaged: !includeTriaged,
        // One more than shown, to tell whether the list was cut off
        issueLimit: issues + 1,
        limit: limit || 1,
      })
      const shown = summary.issues.slice(0, issues)
      const appsWithIssues = [...new Set(summary.issues.map((i) => i.app))]
      const unreleased = appsWithIssues.filter((a) =>
        summary.issues.every((i) => i.app !== a || !i.releases.length),
      )
      return text({
        ...summary,
        ...(app && { app }),
        issues: shown,
        issuesTruncated: summary.issues.length > shown.length,
        recentErrors: limit ? summary.recentErrors : [],
        ...(unreleased.length && { notes: unreleased.map(noRelease) }),
      })
    },
  )

  server.registerTool(
    'get_issue',
    {
      description:
        "Drill into one issue (a recurring error or warning) by a fingerprint from get_error_summary or search_logs. Returns its summary with count/users over the window and totalCount over all retained time, triage state, its latest stack, breakdowns by release, path, status and user, a per-bucket series, and its most recent occurrences (each with timestamp, request ID, user, path, status and stack). Pass an occurrence's reqId to search_logs to see the whole request.",
      inputSchema: {
        fingerprint: z
          .string()
          .regex(/^[0-9a-f]{16}$/)
          .describe('Issue fingerprint'),
        hours: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Window for counts and breakdowns (default 24, up to retention)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Max occurrences, newest first (default 20)'),
      },
    },
    async ({ fingerprint, hours, limit = 20 }) => {
      const issue = await getIssueDetail(fingerprint, hours, limit)
      if (!issue) return fail(`No issue with fingerprint ${fingerprint}`)
      const { buckets, ...window } = issue.window
      return text({
        ...issue,
        window: { ...window, bucketStart: buckets[0] },
        ...(!issue.releases.length && { notes: [noRelease(issue.app)] }),
      })
    },
  )

  server.registerTool(
    'read_logs',
    {
      description:
        'Read the most recent lines of a log source, paginating backwards. Pass the returned nextBefore as "before" to get older lines.',
      inputSchema: {
        source: z.string().describe('Source path from list_log_sources'),
        service: serviceParam,
        env: envParam,
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
    async ({ source, service, env, limit = 100, before }) => {
      if (source.startsWith('ingested:')) {
        return text(
          await getHistory(source.slice('ingested:'.length), before, limit, { service, env }),
        )
      }
      const entry = getLogConfig().find((l) => l.path === source)
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
        'Search ingested events across ALL apps by default, or one app, service or environment. Filter by any combination of text (substring or regex over every field), request ID, time window, level, HTTP status (exact or a class like "5xx"), error code, user ID, route pattern and path prefix; at least one filter is required. Returns the newest matches in chronological order as parsed events (id, app, service, env, ts, level, msg, code, reqId, method, path, route, status, duration, userId, release, stack, fingerprint, extra). Old plain-text lines have level null and only ts and msg. An event id works as read_logs "before"; a fingerprint works with get_issue.',
      inputSchema: {
        source: z
          .string()
          .optional()
          .describe('One app, e.g. "ingested:myapp" or "myapp". Omit to search every app.'),
        service: serviceParam,
        env: envParam,
        query: z.string().optional().describe('Text to find in any field'),
        regex: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        reqId: z.string().optional().describe('Only events of this request'),
        since: z.string().optional().describe('ISO timestamp, inclusive lower bound'),
        until: z.string().optional().describe('ISO timestamp, inclusive upper bound'),
        levels: z
          .array(z.enum(LEVEL_FILTERS))
          .optional()
          .describe('Levels to include; "none" is old plain-text lines'),
        status: z
          .union([z.number().int(), z.string().regex(/^[1-5]xx$/i)])
          .optional()
          .describe('HTTP status, e.g. 404 or "5xx"'),
        code: z.string().optional().describe('Error code, exact'),
        userId: z.string().optional(),
        route: z.string().optional().describe('Route pattern, exact, e.g. "/users/:id"'),
        pathPrefix: z.string().optional().describe('Request path prefix, e.g. "/api/sheets"'),
        extra: extraParam,
        context: z
          .number()
          .int()
          .min(0)
          .max(20)
          .optional()
          .describe('Events of the same app before and after each match (any service) (default 0)'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Max matches, newest kept (default 100)'),
      },
    },
    async ({ source, ...filters }) => {
      const { query, regex, caseSensitive, context, limit, ...narrowing } = filters
      if (!query && !Object.values(narrowing).some((v) => v !== undefined)) {
        return fail('Provide a query or at least one filter')
      }
      if (source && getLogConfig().some((l) => l.path === source)) {
        return fail(
          'search_logs only supports ingested sources; use read_logs for configured files',
        )
      }
      const result = await searchEvents({ app: appOf(source), ...filters })
      return 'error' in result ? fail(result.error) : text(result)
    },
  )

  server.registerTool(
    'set_issue_state',
    {
      description:
        'Triage issues by fingerprint (from get_error_summary or search_logs). "muted" hides an issue from summaries and counts for good, for noise such as scanner traffic; "resolved" hides it until it happens again, when it reopens as a regression; "open" undoes either. Use this once an issue is understood so get_error_summary keeps showing only what needs attention.',
      inputSchema: {
        fingerprints: z
          .array(z.string().regex(/^[0-9a-f]{16}$/))
          .min(1)
          .max(100)
          .describe('Issue fingerprints'),
        state: z.enum(['open', 'resolved', 'muted']),
      },
    },
    async ({ fingerprints, state }) => {
      const known = new Set(
        (await issueSummaries({ fingerprints, limit: fingerprints.length })).map(
          (i) => i.fingerprint,
        ),
      )
      const unknown = fingerprints.filter((f) => !known.has(f))
      if (unknown.length) return fail(`No issue with fingerprint ${unknown.join(', ')}`)
      await setIssueState(fingerprints, state)
      return text({ updated: fingerprints.length, state })
    },
  )

  server.registerTool(
    'count_events',
    {
      description: `Count matching events per value of one field, largest first: failures per platform, errors per route, events per hour. Takes the same filters as search_logs (default window: the last 24 hours; regex is not supported). groupBy is one of ${GROUP_BY_FIELDS.join(', ')}; extra.<field> groups by a field the app sent beyond the standard ones, e.g. extra.platform.`,
      inputSchema: {
        groupBy: z.string().describe(`Field to group by: ${GROUP_BY_FIELDS.join(', ')}`),
        groups: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Groups to return (default 20)'),
        source: z
          .string()
          .optional()
          .describe('One app, e.g. "ingested:myapp" or "myapp". Omit to count every app.'),
        service: serviceParam,
        env: envParam,
        query: z.string().optional().describe('Text to find in any field'),
        caseSensitive: z.boolean().optional(),
        since: z
          .string()
          .optional()
          .describe('ISO timestamp, inclusive lower bound (default 24h ago)'),
        until: z.string().optional().describe('ISO timestamp, inclusive upper bound'),
        levels: z.array(z.enum(LEVEL_FILTERS)).optional(),
        status: z.union([z.number().int(), z.string().regex(/^[1-5]xx$/i)]).optional(),
        code: z.string().optional().describe('Error code, exact'),
        userId: z.string().optional(),
        route: z.string().optional().describe('Route pattern, exact'),
        pathPrefix: z.string().optional(),
        extra: extraParam,
      },
    },
    async ({ source, ...options }) => {
      const result = await countEvents({ app: appOf(source), ...options })
      return 'error' in result ? fail(result.error) : text(result)
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
