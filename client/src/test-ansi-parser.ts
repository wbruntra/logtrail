import { parseLogLine } from './utils/logParser'

// Test with actual ANSI codes from your logs
const testLogLine = '\x1b[0mGET /api/public/talent-sheets/gEWR406?page=1&limit=18&with_stats=false \x1b[32m200\x1b[0m 25.149 ms - 18817\x1b[0m'

console.log('Testing ANSI log parsing...')
console.log('Input:', JSON.stringify(testLogLine))

const result = parseLogLine(testLogLine)
console.log('Parsed result:', JSON.stringify(result, null, 2))

console.log('\nSegments breakdown:')
result.segments.forEach((segment, i) => {
  console.log(`Segment ${i}:`, {
    text: JSON.stringify(segment.text),
    className: segment.className
  })
})

export {}
