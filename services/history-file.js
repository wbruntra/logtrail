const { exec } = require('child_process')
const { promisify } = require('util')
const fs = require('fs').promises

const execAsync = promisify(exec)

async function getLogHistory(filePath, beforeLine, limit = 100) {
  try {
    // First, get the total number of lines in the file efficiently
    const { stdout: wcOutput } = await execAsync(`wc -l < "${filePath}"`)
    const totalLines = parseInt(wcOutput.trim(), 10)

    // Calculate the range
    let end = beforeLine !== undefined ? beforeLine - 1 : totalLines
    if (end > totalLines) end = totalLines

    const start = Math.max(1, end - limit + 1)

    // If start is greater than end, return empty result
    if (start > end || end <= 0) {
      return {
        lines: [],
        hasMore: false,
        nextBefore: 0,
        totalLines
      }
    }

    // Use sed to extract the specific line range
    const { stdout } = await execAsync(`sed -n '${start},${end}p' "${filePath}"`)

    // Split into lines and filter out empty lines if the file ends with newlines
    const lines = stdout.split('\n')
    // Remove the last empty line if it exists (common with sed output)
    if (lines[lines.length - 1] === '') {
      lines.pop()
    }

    // Create line objects with line numbers
    const linesWithNumbers = lines.map((content, index) => ({
      lineNumber: start + index,
      content: content
    }))

    return {
      lines: linesWithNumbers,
      hasMore: start > 1,
      nextBefore: start,
      totalLines
    }
  } catch (error) {
    // If the file doesn't exist or there's another error, throw a descriptive error
    if (error.code === 'ENOENT' || error.message.includes('No such file')) {
      throw new Error(`File not found: ${filePath}`)
    }
    throw new Error(`Failed to read log file: ${error.message}`)
  }
}

module.exports = { getLogHistory }
