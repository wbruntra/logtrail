import type { Context, Next } from 'hono'

interface LoggerConfig {
  ignoredPaths?: string[]
  ignoredPatterns?: RegExp[]
  getUserId?: (c: Context) => string | undefined
}

const RESET = '\x1b[0m'
const METHOD_COLOR: Record<string, string> = {
  GET: '\x1b[34m',
  POST: '\x1b[35m',
  PUT: '\x1b[33m',
  PATCH: '\x1b[33m',
  DELETE: '\x1b[31m',
}

const statusColor = (s: number): string =>
  s >= 500 ? '\x1b[31m' : s >= 400 ? '\x1b[33m' : s >= 300 ? '\x1b[36m' : '\x1b[32m'

export function createLogger(config: LoggerConfig = {}) {
  const { ignoredPaths = [], ignoredPatterns = [], getUserId } = config

  return async (c: Context, next: Next) => {
    const start = Date.now()
    const { pathname, search } = new URL(c.req.url)

    if (
      ignoredPaths.some((p) => pathname.startsWith(p)) ||
      ignoredPatterns.some((r) => r.test(pathname))
    ) {
      return next()
    }

    await next()

    const method = c.req.method
    const status = c.res.status
    const ms = Date.now() - start
    const userId = getUserId?.(c)
    const ts = new Date().toTimeString().slice(0, 8)

    const parts = [
      `[${ts}]`,
      `${METHOD_COLOR[method] ?? '\x1b[36m'}${method}${RESET}`,
      `${pathname}${search}`,
      `${statusColor(status)}${status}${RESET}`,
      `${ms}ms`,
      userId ? `user=${userId}` : null,
    ]
      .filter(Boolean)
      .join(' ')

    console.log(parts)
  }
}
