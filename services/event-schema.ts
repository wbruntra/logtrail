import { LEVELS } from '@database/schema'
import { z } from 'zod'
import { parseLines } from './line-parser'
import { type Source, resolveSource } from './source'

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
  | { kind: 'events'; source: Source; events: IngestEvent[]; rejected: RejectedEvent[] }
  | { kind: 'invalid'; error: string }

function describe(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message)
    .join('; ')
}

/**
 * Accepts, in order of preference:
 *   { app, service?, env?, events: [...] }  batch of structured events (sdk/logtrail.ts)
 *   { app, level, msg, ...fields }    single structured event (logtrail-middleware.js)
 *   { app, service?, env?, file?, requestAlerts?, lines: string[] }  raw lines from a log file (the agent),
 *                                    parsed into events by ./line-parser
 * A bare { app, msg } without a level is rejected.
 */
export function parseIngestPayload(body: unknown): IngestPayload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { kind: 'invalid', error: 'Body must be a JSON object' }
  }
  const {
    app: rawApp,
    service: rawService,
    env: rawEnv,
    events,
    lines,
    file,
    requestAlerts,
    ...rest
  } = body as Record<string, unknown>

  const app = appName.safeParse(rawApp)
  if (!app.success) return { kind: 'invalid', error: 'app field is required' }

  const optional = z.string().trim().max(100).nullish()
  const service = optional.safeParse(rawService)
  const env = optional.safeParse(rawEnv)
  if (!service.success || !env.success) {
    return { kind: 'invalid', error: 'service and env must be strings' }
  }
  const source = resolveSource(app.data, service.data, env.data)

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
    return { kind: 'events', source, events: valid, rejected }
  }

  if (Array.isArray(lines)) {
    const strings = lines.filter((l): l is string => typeof l === 'string').map(clip(MAX_LINE))
    const fileName = typeof file === 'string' ? clip(200)(file) : undefined
    const parsed = parseLines(strings, { requestAlerts: requestAlerts !== false })
    if (!parsed.length) return { kind: 'invalid', error: 'No valid lines provided' }
    const valid: IngestEvent[] = []
    const rejected: RejectedEvent[] = []
    parsed.slice(0, MAX_BATCH).forEach((e, index) => {
      const result = eventSchema.safeParse({ ...e, source: 'file', file: fileName })
      if (result.success) valid.push(result.data)
      else rejected.push({ index, error: describe(result.error) })
    })
    return { kind: 'events', source, events: valid, rejected }
  }

  const level = typeof rest.level === 'string' ? rest.level.toLowerCase() : null
  if (level && (LEVELS as readonly string[]).includes(level)) {
    const parsed = eventSchema.safeParse(rest)
    if (!parsed.success) return { kind: 'invalid', error: describe(parsed.error) }
    return { kind: 'events', source, events: [parsed.data], rejected: [] }
  }

  return {
    kind: 'invalid',
    error:
      'Send structured events: { app, events: [{ level, msg, ... }] }. Raw log lines go in { app, lines: [...] }; apps use sdk/logtrail.ts.',
  }
}
