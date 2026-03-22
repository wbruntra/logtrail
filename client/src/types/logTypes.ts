export interface LogFile {
  name: string
  path: string
  description?: string
}

export interface LogLine {
  lineNumber: number
  content: string
}

// A structured event emitted by logtrail-middleware (stored as a JSON line)
export interface StructuredEvent {
  ts: string
  level: 'error' | 'warn' | 'info' | 'debug' | 'success'
  msg: string
  code?: string
  method?: string
  path?: string
  status?: number
  duration?: number
  reqId?: string
  userId?: string | number
  stack?: string
}
