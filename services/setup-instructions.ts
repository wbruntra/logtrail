import { db } from '@database/db'

/** Apps and their services already sending events, so a new integration reuses their names. */
async function knownSources(): Promise<string> {
  const rows = await db
    .selectFrom('events')
    .select(['app', 'service'])
    .distinct()
    .orderBy('app')
    .orderBy('service')
    .execute()
  const byApp = new Map<string, string[]>()
  for (const { app, service } of rows) byApp.set(app, [...(byApp.get(app) ?? []), service])
  if (!byApp.size) return '_None yet._'
  return [...byApp].map(([app, services]) => `- \`${app}\`: ${services.join(', ')}`).join('\n')
}

/** Markdown an LLM coding agent can follow to connect a project to logtrail. Holds no secrets. */
export async function setupInstructions(baseUrl: string): Promise<string> {
  return `# Connect this project to logtrail

logtrail collects structured logs and errors from apps. Apps send them with a small
drop-in client; nothing tails log files. Follow these steps in the project you are
working on.

Logtrail URL: ${baseUrl}

## 1. Choose the names

Every event carries three names. Pick them once and keep them stable:

- **app**: the product or codebase, lowercase with hyphens. All processes of one codebase share it.
- **service**: this process within the app, e.g. \`api\`, \`auth\`, \`story-worker\`. Defaults to the app name.
- **env**: \`production\`, \`staging\`, \`development\`. Take it from the deployment's environment, never hardcode it.

Names already in logtrail (reuse them if this project is one of these):

${await knownSources()}

If it is unclear which app this project belongs to, ask the user.

## 2. Add the client

Copy the dependency-free client into the project (Bun, Node 22.18+, or Workers with nodejs_compat):

\`\`\`sh
curl -o src/logtrail.ts ${baseUrl}/api/client/logtrail.ts
\`\`\`

For plain JavaScript use \`logtrail.js\` (ESM) or \`logtrail.cjs\` (CommonJS) from the same path.
Read the comment at the top of the file: it documents every option.

## 3. Configure it

The secret is a credential: read it from the environment and never write it into source,
config files or commits. Ask the user to set \`LOGTRAIL_SECRET\` for each deployment; \`LOGTRAIL_URL\` is ${baseUrl}.

\`\`\`ts
import { createLogtrail } from './logtrail'

export const logtrail = createLogtrail({
  url: process.env.LOGTRAIL_URL!,
  secret: process.env.LOGTRAIL_SECRET!,
  app: 'my-product',       // from step 1
  service: 'api',          // from step 1
  env: process.env.NODE_ENV, // production / staging / development
  release: process.env.GIT_SHA, // the deployed commit, if available
  enabled: !!process.env.LOGTRAIL_SECRET, // no-op in tests and local runs
})
\`\`\`

## 4. Hook it in

- **Hono**: \`app.use('*', logtrail.hono())\` before the routes.
- **Express**: \`app.use(logtrail.express())\` before the routes and \`app.use(logtrail.expressErrors())\` after them, before your own error handler.
- **Workers, scripts and queue consumers** (no HTTP server): skip the middleware.

In every process also call:

\`\`\`ts
logtrail.captureProcessErrors() // uncaught exceptions and rejections, flushed before exit
logtrail.captureConsole()       // console.* still prints and is also sent as events
\`\`\`

Pass \`getUser: (ctx) => ctx.get('user')?.id\` if requests have a logged-in user, and
\`skip: ({ path }) => path === '/health'\` to leave out health checks and bot noise.
Only 4xx/5xx responses are recorded by default. Set \`logRequests: true\` to also record successful requests (as \`debug\` events with route, status and duration), which replaces an access log such as morgan. Output a library writes straight to stdout (morgan, pino) is not captured by \`captureConsole()\`; route it through \`console\` or the client if it matters.

Elsewhere in the code, \`logtrail.log('info', 'message', { extra })\` and \`logtrail.error(err, { extra })\` send events with the current request's id attached.

## 5. Clean up

If this project ships its log files with a logtrail agent (\`logtrail-agent\`, a pm2 entry, an agent config), remove it. Logtrail no longer accepts raw log lines, so the agent's requests are rejected.

## 6. Verify

Start the app with \`LOGTRAIL_URL\` and \`LOGTRAIL_SECRET\` set, trigger an error (a route that throws, or \`logtrail.error(new Error('logtrail test'))\`), and check that it appears in logtrail under the chosen app, service and env. The raw API, for debugging:

\`\`\`sh
curl -X POST ${baseUrl}/api/ingest \\
  -H "Authorization: Bearer $LOGTRAIL_SECRET" -H "Content-Type: application/json" \\
  -d '{"app":"my-product","service":"api","env":"staging","events":[{"level":"error","msg":"logtrail test"}]}'
\`\`\`

A \`401\` means the secret is wrong; a \`400\` explains what the payload lacks.
`
}
