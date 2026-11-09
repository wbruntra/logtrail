// Turns raw log lines (from agent/logtrail-agent.js tailing a file) into events, so the
// output of any logger lands in the same shape as SDK events. Recognised, in order:
//   - JSON lines (pino, bunyan, winston): level, message, time and request id are mapped
//   - morgan "dev" access lines: GET /path 200 3.9 ms - 59169
//   - text, with an optional leading ISO timestamp and level word
// Indented "at ..." lines are stack frames and join the event before them. So does a
// pretty-printed object (console.log(obj) over several lines, from "... {" to its closing
// "}"), so its fields don't become events of their own with a level read from "error: false,".

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const ACCESS =
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+) (\d{3}) (\d+(?:\.\d+)?) ms(?: - \S+)?$/
const LEADING_TS = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+/
const LEADING_LEVEL = /^\[?(error|warn(?:ing)?|info|debug|trace|fatal|success)\]?\s*[:\-]?\s+/i
const STACK_FRAME = /^\s+at\s/

/** Longest multi-line object kept as one event; a dump that never closes is cut here. */
export const MAX_BLOCK_LINES = 100

/**
 * How a line changes the nesting of a pretty-printed object: +1 when it ends by opening
 * one ("sending notification {", "items: ["), -1 when it starts by closing one, so
 * "}, {" nets 0 and "}," closes. Inline "{}" and "[Object]" don't count.
 */
export function blockDelta(line: string): number {
  const t = line.replace(ANSI, '').trim()
  return (/[{[]$/.test(t) ? 1 : 0) - (/^[}\]]/.test(t) ? 1 : 0)
}

/**
 * Whether a line can be part of an open object: its fields are indented, and it ends with a
 * closing bracket. A line at the left edge that isn't one (the next log line, or a code
 * frame like "78 | if (x) {") means the object was cut off.
 */
const continuesBlock = (line: string) => /^\s/.test(line) || /^[}\]]/.test(line)

/**
 * How many leading lines hold only complete events, leaving out a trailing object that has
 * not closed yet. Callers that send lines in batches cut there, so no object is split.
 */
export function completeLineCount(lines: string[]): number {
  let depth = 0
  let start = 0
  lines.forEach((line, i) => {
    if (!line.trim()) return
    if (depth > 0 && !continuesBlock(line)) depth = 0
    if (depth === 0) {
      start = i
      depth = Math.max(0, blockDelta(line))
      return
    }
    depth += blockDelta(line)
    if (i - start + 1 >= MAX_BLOCK_LINES) depth = 0
  })
  return depth > 0 ? start : lines.length
}

type Level = 'error' | 'warn' | 'info' | 'debug' | 'success'

export interface ParsedLine {
  ts?: string
  level: Level
  msg: string
  stack?: string
  [field: string]: unknown
}

/** pino uses numbers (10 trace ... 60 fatal); others use names. */
function levelOf(value: unknown): Level | undefined {
  if (typeof value === 'number') {
    return value >= 50 ? 'error' : value >= 40 ? 'warn' : value >= 30 ? 'info' : 'debug'
  }
  if (typeof value !== 'string') return undefined
  const v = value.toLowerCase()
  if (v === 'fatal' || v === 'err') return 'error'
  if (v === 'warning') return 'warn'
  if (v === 'trace' || v === 'verbose' || v === 'silly') return 'debug'
  return ['error', 'warn', 'info', 'debug', 'success'].includes(v) ? (v as Level) : undefined
}

function isoOf(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
}

function fromJson(line: string): ParsedLine | undefined {
  if (!line.startsWith('{')) return undefined
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined
  const msg = [obj.msg, obj.message].find((m): m is string => typeof m === 'string' && !!m.trim())
  const err = obj.err ?? obj.error
  const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : undefined
  const text = msg ?? (typeof errObj?.message === 'string' ? errObj.message : undefined)
  if (!text) return undefined
  const { msg: _m, message: _msg, level, time, timestamp, ts, err: _e, error: _er, ...rest } = obj
  const reqId = [rest.reqId, rest.requestId, rest.req_id].find((r) => typeof r === 'string')
  const parsed: ParsedLine = {
    ...rest,
    level: levelOf(level) ?? (errObj ? 'error' : 'info'),
    msg: text,
    ts: isoOf(time ?? timestamp ?? ts),
  }
  if (typeof reqId === 'string') parsed.reqId = reqId
  if (typeof errObj?.stack === 'string') parsed.stack = errObj.stack
  if (typeof errObj?.code === 'string') parsed.code = errObj.code
  return parsed
}

function fromAccess(text: string, alerts: boolean): ParsedLine | undefined {
  const m = ACCESS.exec(text)
  if (!m) return undefined
  const status = Number(m[3])
  const path = m[2].split('?')[0]
  return {
    level: !alerts ? 'debug' : status >= 500 ? 'error' : status >= 400 ? 'warn' : 'debug',
    msg: `${m[1]} ${path} ${status}`,
    method: m[1],
    path,
    status,
    duration: Number(m[4]),
  }
}

function fromText(text: string): ParsedLine {
  let rest = text
  const ts = LEADING_TS.exec(rest)
  if (ts) rest = rest.slice(ts[0].length)
  const lead = LEADING_LEVEL.exec(rest)
  const level = lead ? levelOf(lead[1]) : undefined
  if (lead && level) rest = rest.slice(lead[0].length)
  return { level: level ?? 'info', msg: rest, ts: ts ? isoOf(ts[1]) : undefined }
}

export interface ParseOptions {
  /**
   * Whether 4xx/5xx access lines are warnings and errors (default). Turn off when the app
   * reports its errors itself, so a failed request isn't an issue twice; the lines stay
   * as debug events with their status.
   */
  requestAlerts?: boolean
}

export function parseLines(
  lines: string[],
  { requestAlerts = true }: ParseOptions = {},
): ParsedLine[] {
  const events: ParsedLine[] = []
  // The event an unclosed pretty-printed object belongs to, how deep we are, how many lines in
  let block: { event: ParsedLine; depth: number; size: number; inStack: boolean } | undefined
  for (const raw of lines) {
    const text = raw.replace(ANSI, '').trimEnd()
    if (!text.trim()) continue
    const previous = events[events.length - 1]
    if (block && !continuesBlock(text)) block = undefined
    if (block) {
      const field = block.inStack ? 'stack' : 'msg'
      block.event[field] = `${block.event[field]}\n${text}`
      block.depth += blockDelta(text)
      block.size++
      if (block.depth <= 0 || block.size >= MAX_BLOCK_LINES) block = undefined
      continue
    }
    if (STACK_FRAME.test(text) && previous) {
      previous.stack = previous.stack ? `${previous.stack}\n${text}` : `${previous.msg}\n${text}`
      // An error with extra properties ends its last frame with "{": "at x (/x.js:1:1) {"
      if (blockDelta(text) > 0) block = { event: previous, depth: 1, size: 1, inStack: true }
      continue
    }
    const event = fromJson(text) ?? fromAccess(text.trim(), requestAlerts) ?? fromText(text.trim())
    events.push(event)
    if (blockDelta(text) > 0) block = { event, depth: 1, size: 1, inStack: false }
  }
  return events
}
