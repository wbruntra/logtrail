import { parseLogLine } from '../src/utils/logParser'

// Test cases based on the actual log file
const testCases = [
  'GET /api/public/talent-sheets/PEy5P1E?page=1&limit=18&with_stats=false 200 33.526 ms - 18185',
  'POST /api/analytics 200 1.928 ms - 2',
  'GET /api/status 304 0.734 ms - -',
  'POST /api/auth/login 401 8.123 ms - 128',
  'POST /api/users 400 18.234 ms - 512',
  'POST /api/service-error 503 85.234 ms - 256',
  'total socials 148',
  'WARN: Deprecated API endpoint accessed',
  'DEBUG: Processing request for /api/data',
  'sending cached sheet public_talent_sheet:20494 page_1_limit_18'
]

console.log('Testing log parser...\n')

testCases.forEach((testCase, index) => {
  console.log(`Test ${index + 1}: "${testCase}"`)
  const result = parseLogLine(testCase)
  console.log(`  Level: ${result.level.type}`)
  console.log(`  Status Code: ${result.level.statusCode || 'none'}`)
  console.log(`  Method: ${result.level.method || 'none'}`)
  console.log(`  Segments: ${result.segments.length}`)
  result.segments.forEach((segment, i) => {
    if (segment.className) {
      console.log(`    [${i}] "${segment.text}" (${segment.className})`)
    }
  })
  console.log('')
})
