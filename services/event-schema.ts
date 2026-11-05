import { LEVELS } from '@database/schema'
import { z } from 'zod'

// The ingest contract: what sdk/logtrail.ts (and older clients) send to POST /api/ingest.

const MAX_BATCH = 500
const MAX_LINE = 8000

const clip = (max: number) => (s: string) => (s.length > max ? s.slice(0, max) : s)
const text = (max: number) => z.string().transform(clip(max)).nullish()

/** App names double as directory names in the legacy file store, so keep them filesystem-safe. */
export const appName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((s) => s.replace(/[^a-zA-Z0-9_-]/g, '_'))

export const eventSchema = z.looseObject({
  ts: z.string().nullish(),
  level: z
    .string()
    .transform((s) => s.toLowerCase())
    .pipe(z.enum(LEVELS)),
  msg: z.string().trim().min(1).transform(clip(4000)),
  code: z
    .union([z.string(), z.number()])
    .transform((v) => clip(200)(String(v)))
    .nullish(),
  reqId: text(100),
  method: text(16),
  path: text(2000),
  route: text(500),
  status: z.number().int().min(100).max(599).nullish(),
  duration: z.number().nonnegative().nullish(),
  userId: z
    .union([z.string(), z.number()])
    .transform((v) => clip(200)(String(v)))
    .nullish(),
  release: text(100),
  stack: text(16000),
})

export type IngestEvent = z.output<typeof eventSchema>

export interface RejectedEvent {
  index: number
  error: string
}

export type IngestPayload =
  | { kind: 'events'; app: string; events: IngestEvent[]; rejected: RejectedEvent[] }
  | { kind: 'lines'; app: string; lines: string[] }
  | { kind: 'invalid'; error: string }

function describe(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message)
    .join('; ')
}

/**
 * Accepts, in order of preference:
 *   { app, events: [...] }            batch of structured events (sdk/logtrail.ts)
 *   { app, level, msg, ...fields }    single structured event (logtrail-middleware.js)
 *   { app, lines: string[] }          unstructured lines (agent)
 *   { app, msg }                      single unstructured line
 */
export function parseIngestPayload(body: unknown): IngestPayload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { kind: 'invalid', error: 'Body must be a JSON object' }
  }
  const { app: rawApp, events, lines, ...rest } = body as Record<string, unknown>

  const app = appName.safeParse(rawApp)
  if (!app.success) return { kind: 'invalid', error: 'app field is required' }

  if (Array.isArray(events)) {
    if (!events.length) return { kind: 'invalid', error: 'events must not be empty' }
    if (events.length > MAX_BATCH) {
      return { kind: 'invalid', error: `At most ${MAX_BATCH} events per request` }
    }
    const valid: IngestEvent[] = []
    const rejected: RejectedEvent[] = []
    events.forEach((e, index) => {
      const parsed = eventSchema.safeParse(e)
      if (parsed.success) valid.push(parsed.data)
      else rejected.push({ index, error: describe(parsed.error) })
    })
    return { kind: 'events', app: app.data, events: valid, rejected }
  }

  if (Array.isArray(lines)) {
    const valid = lines
      .filter((l): l is string => typeof l === 'string' && l.trim() !== '')
      .map(clip(MAX_LINE))
    if (!valid.length) return { kind: 'invalid', error: 'No valid lines provided' }
    return { kind: 'lines', app: app.data, lines: valid }
  }

  const level = typeof rest.level === 'string' ? rest.level.toLowerCase() : null
  if (level && (LEVELS as readonly string[]).includes(level)) {
    const parsed = eventSchema.safeParse(rest)
    if (!parsed.success) return { kind: 'invalid', error: describe(parsed.error) }
    return { kind: 'events', app: app.data, events: [parsed.data], rejected: [] }
  }

  if (typeof rest.msg === 'string' && rest.msg.trim()) {
    return { kind: 'lines', app: app.data, lines: [clip(MAX_LINE)(rest.msg.trim())] }
  }

  return {
    kind: 'invalid',
    error: 'events (array), lines (array), msg (string), or a structured event with level required',
  }
}
