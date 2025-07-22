const { exec } = require('child_process')
const { promisify } = require('util')

const execAsync = promisify(exec)

async function tailFile(filePath, lines = 100) {
  try {
    const { stdout } = await execAsync(`tail -n ${lines} "${filePath}"`)

    // Remove the trailing newline if present to match original behavior
    return stdout.replace(/\n$/, '')
  } catch (error) {
    if (error.code === 'ENOENT' || error.message.includes('No such file')) {
      throw new Error(`File not found: ${filePath}`)
    }
    throw new Error(`Failed to read log file: ${error.message}`)
  }
}

module.exports = { tailFile }
