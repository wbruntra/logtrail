const fs = require('fs')
const path = require('path')

const logFilePath1 = path.join(__dirname, '../test/log.txt')
const logFilePath2 = path.join(__dirname, '../test/log2.txt')

// Sample Express-style log entries with various HTTP status codes and methods
const logTemplates = [
  // Success responses (2xx)
  'GET /api/users 200 25.123 ms - 1024',
  'POST /api/auth/login 201 45.678 ms - 256',
  'PUT /api/users/123 200 12.456 ms - 512',
  'GET /api/status 200 5.123 ms - 128',
  'POST /api/analytics 200 8.234 ms - 64',
  
  // Redirects (3xx)
  'GET /api/public/data 304 2.123 ms - -',
  'GET /api/users/profile 302 15.678 ms - 0',
  
  // Client errors (4xx)
  'GET /api/nonexistent 404 12.345 ms - 256',
  'POST /api/auth/login 401 8.123 ms - 128',
  'GET /api/forbidden 403 5.678 ms - 64',
  'POST /api/users 400 18.234 ms - 512',
  
  // Server errors (5xx)
  'GET /api/internal-error 500 125.678 ms - 1024',
  'POST /api/service-error 503 85.234 ms - 256',
  
  // Application-specific logs
  'sending cached sheet public_talent_sheet:20494 page_1_limit_18',
  'total socials 148',
  'TEAM ID 134',
  'User authentication successful for user@example.com',
  'Cache hit for key: user_session_abc123',
  'Database connection established',
  
  // Log level examples
  'INFO: Application started successfully',
  'WARN: Deprecated API endpoint accessed',
  'ERROR: Database connection failed',
  'DEBUG: Processing request for /api/data',
  'FATAL: Critical system failure detected'
]

let logIndex = 0

function getRandomLogEntry() {
  const template = logTemplates[logIndex % logTemplates.length]
  logIndex++
  return template
}

function writeLog(filePath, prefix = '') {
  const logEntry = getRandomLogEntry()
  const logMessage = `${prefix}${logEntry}\n`
  
  fs.appendFile(filePath, logMessage, (err) => {
    if (err) {
      console.error(`Error writing to ${filePath}:`, err)
    }
  })
}

console.log(`Starting Express-style log writer. Appending to both ${logFilePath1} and ${logFilePath2}`)
console.log('This will generate logs with various HTTP status codes for testing log level detection')

// Write logs every 3 seconds
setInterval(() => {
  writeLog(logFilePath1)
  
  // Write to second file with slight delay
  setTimeout(() => {
    writeLog(logFilePath2, '[SECONDARY] ')
  }, 1000)
}, 3000)
