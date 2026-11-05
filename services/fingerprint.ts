import { createHash } from 'node:crypto'

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
// Long hex runs with at least one digit: object ids, hashes, request ids
const HEX_ID = /\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi
const NUMBER = /\d+/g

/** Strip the parts of a message that vary between occurrences of the same problem. */
export function normalizeMessage(msg: string): string {
  return msg.replace(UUID, '<id>').replace(HEX_ID, '<id>').replace(NUMBER, '<n>').slice(0, 500)
}

/** /users/123/orders/9f86d081... -> /users/:id/orders/:id */
export function normalizePath(path: string): string {
  return path
    .split('?')[0]
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) ? ':id' : seg))
    .join('/')
}

/** First stack frame in the app's own code, without line/column numbers. */
export function topFrame(stack: string): string | null {
  for (const line of stack.split('\n').slice(1)) {
    const frame = line.trim()
    if (!frame.startsWith('at ')) continue
    if (frame.includes('node_modules') || frame.includes('node:') || frame.includes('native'))
      continue
    // Line numbers shift between releases; the function and file identify the site.
    return frame.replace(/:\d+(:\d+)?(?=\)?$)/, '')
  }
  return null
}

interface FingerprintInput {
  app: string
  level: string | null
  code?: string | null
  msg: string
  method?: string | null
  route?: string | null
  path?: string | null
  status?: number | null
  stack?: string | null
}

/**
 * Stable id for "the same problem": app + where (method and route) + what
 * (error code, or the message with ids removed) + HTTP status + top app frame.
 * Only errors and warnings are grouped into issues.
 */
export function fingerprint(e: FingerprintInput): string | null {
  if (e.level !== 'error' && e.level !== 'warn') return null
  const where = `${e.method ?? ''} ${e.route ?? (e.path ? normalizePath(e.path) : '')}`
  const what = e.code ?? normalizeMessage(e.msg)
  const frame = e.stack ? (topFrame(e.stack) ?? '') : ''
  return createHash('sha1')
    .update([e.app, where, what, e.status ?? '', frame].join('\n'))
    .digest('hex')
    .slice(0, 16)
}
