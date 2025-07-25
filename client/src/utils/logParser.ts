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
 * Parse a log line and detect HTTP status codes, methods, and log levels
 */
export function parseLogLine(logLine: string): ParsedLog {
  const segments: LogSegment[] = []
  let level: LogLevel = { type: 'default' }
  
  // HTTP Status Code patterns - more specific to Express log format
  // Matches: METHOD /path STATUS (where STATUS is 3 digits after a space, before a space and number with ms or -)
  const statusCodeRegex = /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+[^\s]+\s+([1-5]\d{2})\s+(?:\d+\.\d+\s+ms|\-)/g
  const httpMethodRegex = /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g
  
  // Log level patterns (case insensitive)
  const errorRegex = /\b(ERROR|FATAL|CRITICAL)\b/gi
  const warnRegex = /\b(WARN|WARNING)\b/gi
  const infoRegex = /\b(INFO|INFORMATION)\b/gi
  const debugRegex = /\b(DEBUG|TRACE|VERBOSE)\b/gi
  
  // Detect overall log level based on content
  if (errorRegex.test(logLine)) {
    level.type = 'error'
  } else if (warnRegex.test(logLine)) {
    level.type = 'warning'
  } else if (infoRegex.test(logLine)) {
    level.type = 'info'
  } else if (debugRegex.test(logLine)) {
    level.type = 'debug'
  } else {
    // Check HTTP status codes to determine level
    const statusMatch = logLine.match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+[^\s]+\s+([1-5]\d{2})\s+(?:\d+\.\d+\s+ms|\-)/)
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
  
  // Extract HTTP method
  const methodMatch = logLine.match(httpMethodRegex)
  if (methodMatch) {
    level.method = methodMatch[0]
  }
  
  // Create segments with highlighting
  let currentIndex = 0
  
  // Find all matches for highlighting
  const allMatches: Array<{ start: number; end: number; className: string; text: string }> = []
  
  // HTTP Methods
  let match
  while ((match = httpMethodRegex.exec(logLine)) !== null) {
    allMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      className: 'log-http-method',
      text: match[0]
    })
  }
  
  // Reset regex
  httpMethodRegex.lastIndex = 0
  
  // HTTP Status Codes - only match in Express log format context
  while ((match = statusCodeRegex.exec(logLine)) !== null) {
    const statusCode = parseInt(match[2]) // Status code is in capture group 2
    let statusClass = 'log-status-default'
    
    if (statusCode >= 500) {
      statusClass = 'log-status-error'
    } else if (statusCode >= 400) {
      statusClass = 'log-status-warning'
    } else if (statusCode >= 300) {
      statusClass = 'log-status-info'
    } else if (statusCode >= 200) {
      statusClass = 'log-status-success'
    }
    
    // Find the position of just the status code within the match
    const fullMatch = match[0]
    const statusCodeText = match[2]
    const statusCodeStart = match.index + fullMatch.indexOf(statusCodeText)
    
    allMatches.push({
      start: statusCodeStart,
      end: statusCodeStart + statusCodeText.length,
      className: statusClass,
      text: statusCodeText
    })
  }
  
  // Reset regex
  statusCodeRegex.lastIndex = 0
  
  // Log Levels
  const logLevelRegex = /\b(ERROR|FATAL|CRITICAL|WARN|WARNING|INFO|INFORMATION|DEBUG|TRACE|VERBOSE)\b/gi
  while ((match = logLevelRegex.exec(logLine)) !== null) {
    const levelText = match[0].toLowerCase()
    let levelClass = 'log-level-default'
    
    if (['error', 'fatal', 'critical'].includes(levelText)) {
      levelClass = 'log-level-error'
    } else if (['warn', 'warning'].includes(levelText)) {
      levelClass = 'log-level-warning'
    } else if (['info', 'information'].includes(levelText)) {
      levelClass = 'log-level-info'
    } else if (['debug', 'trace', 'verbose'].includes(levelText)) {
      levelClass = 'log-level-debug'
    }
    
    allMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      className: levelClass,
      text: match[0]
    })
  }
  
  // Sort matches by start position
  allMatches.sort((a, b) => a.start - b.start)
  
  // Remove overlapping matches (keep the first one)
  const filteredMatches = []
  let lastEnd = 0
  for (const match of allMatches) {
    if (match.start >= lastEnd) {
      filteredMatches.push(match)
      lastEnd = match.end
    }
  }
  
  // Build segments
  currentIndex = 0
  for (const match of filteredMatches) {
    // Add text before the match
    if (match.start > currentIndex) {
      segments.push({
        text: logLine.slice(currentIndex, match.start)
      })
    }
    
    // Add the highlighted match
    segments.push({
      text: match.text,
      className: match.className
    })
    
    currentIndex = match.end
  }
  
  // Add remaining text
  if (currentIndex < logLine.length) {
    segments.push({
      text: logLine.slice(currentIndex)
    })
  }
  
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
