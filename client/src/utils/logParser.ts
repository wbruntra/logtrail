export interface LogLevel {
  type: 'success' | 'info' | 'warning' | 'error' | 'debug' | 'default'
  statusCode?: number
  method?: string
}

export interface ParsedLog {
  originalText: string
  level: LogLevel
  segments: LogSegment[]
}

export interface LogSegment {
  text: string
  className?: string
}

/**
 * Parse ANSI color codes and convert them to CSS classes
 */
function parseAnsiCodes(text: string): LogSegment[] {
  const segments: LogSegment[] = []
  // Match \x1b[XXm or \u001b[XXm patterns (the actual ANSI escape sequences)
  const ansiRegex = /(\x1b\[[\d;]*m|\u001b\[[\d;]*m)/g
  let lastIndex = 0
  let currentClass = ''
  
  // ANSI color code mappings
  const ansiToClass: Record<string, string> = {
    '30': 'ansi-black',
    '31': 'ansi-red',
    '32': 'ansi-green',
    '33': 'ansi-yellow',
    '34': 'ansi-blue',
    '35': 'ansi-magenta',
    '36': 'ansi-cyan',
    '37': 'ansi-white',
    '90': 'ansi-bright-black',
    '91': 'ansi-bright-red',
    '92': 'ansi-bright-green',
    '93': 'ansi-bright-yellow',
    '94': 'ansi-bright-blue',
    '95': 'ansi-bright-magenta',
    '96': 'ansi-bright-cyan',
    '97': 'ansi-bright-white'
  }
  
  let match
  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before the ANSI code
    if (match.index > lastIndex) {
      const textSegment = text.slice(lastIndex, match.index)
      if (textSegment) {
        segments.push({
          text: textSegment,
          className: currentClass || undefined
        })
      }
    }
    
    // Parse the ANSI code - extract the numeric part between [ and m
    const fullCode = match[1]
    let code = ''
    if (fullCode.startsWith('\x1b[')) {
      code = fullCode.slice(2, -1) // Remove \x1b[ and m
    } else if (fullCode.startsWith('\u001b[')) {
      code = fullCode.slice(3, -1) // Remove \u001b[ and m
    }
    
    if (code === '0' || code === '') {
      // Reset code
      currentClass = ''
    } else {
      // Look for color codes
      const colorCode = ansiToClass[code]
      if (colorCode) {
        currentClass = colorCode
      }
    }
    
    lastIndex = match.index + match[0].length
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex)
    if (remainingText) {
      segments.push({
        text: remainingText,
        className: currentClass || undefined
      })
    }
  }
  
  // If no ANSI codes found, return the whole text as one segment
  if (segments.length === 0) {
    segments.push({
      text: text
    })
  }
  
  return segments
}

/**
 * Remove ANSI color escape codes from a string (for parsing logic only)
 */
function stripAnsiCodes(text: string): string {
  // ANSI escape code pattern: \x1b[...m or \u001b[...m or [...m
  return text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\u001b\[[0-9;]*m/g, '').replace(/\[[0-9;]*m/g, '')
}

/**
 * Parse a log line and detect HTTP status codes, methods, and log levels
 */
export function parseLogLine(logLine: string): ParsedLog {
  let level: LogLevel = { type: 'default' }
  
  // Strip ANSI color codes from the log line for parsing logic
  const cleanLogLine = stripAnsiCodes(logLine)
  
  // HTTP Method regex for detecting HTTP methods
  const httpMethodRegex = /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g
  
  // Log level patterns (case insensitive)
  const errorRegex = /\b(ERROR|FATAL|CRITICAL)\b/gi
  const warnRegex = /\b(WARN|WARNING)\b/gi
  const infoRegex = /\b(INFO|INFORMATION)\b/gi
  const debugRegex = /\b(DEBUG|TRACE|VERBOSE)\b/gi
  
  // Detect overall log level based on content (use clean line for detection)
  if (errorRegex.test(cleanLogLine)) {
    level.type = 'error'
  } else if (warnRegex.test(cleanLogLine)) {
    level.type = 'warning'
  } else if (infoRegex.test(cleanLogLine)) {
    level.type = 'info'
  } else if (debugRegex.test(cleanLogLine)) {
    level.type = 'debug'
  } else {
    // Check HTTP status codes to determine level
    const statusMatch = cleanLogLine.match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+[^\s]+\s+([1-5]\d{2})\s+(?:\d+\.\d+\s+ms|\-)/)
    if (statusMatch && statusMatch[2]) {
      const statusCode = parseInt(statusMatch[2])
      level.statusCode = statusCode
      
      if (statusCode >= 500) {
        level.type = 'error'
      } else if (statusCode >= 400) {
        level.type = 'warning'
      } else if (statusCode >= 300) {
        level.type = 'info'
      } else if (statusCode >= 200) {
        level.type = 'success'
      }
    }
  }
  
  // Extract HTTP method (use clean line for consistency)
  const methodMatch = cleanLogLine.match(httpMethodRegex)
  if (methodMatch) {
    level.method = methodMatch[0]
  }
  
  // Parse ANSI codes to create segments with proper coloring
  const segments = parseAnsiCodes(logLine)
  
  return {
    originalText: logLine,
    level,
    segments
  }
}

/**
 * Get CSS class for overall log line based on detected level
 */
export function getLogLineClass(level: LogLevel): string {
  switch (level.type) {
    case 'error':
      return 'log-line-error'
    case 'warning':
      return 'log-line-warning'
    case 'success':
      return 'log-line-success'
    case 'info':
      return 'log-line-info'
    case 'debug':
      return 'log-line-debug'
    default:
      return 'log-line-default'
  }
}
