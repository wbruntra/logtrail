const fs = require('fs')
const path = require('path')

const logFilePath = path.join(__dirname, '../test/log.txt')

function writeLog() {
  const timestamp = new Date().toISOString()
  const logMessage = `[${timestamp}] test\n`

  fs.appendFile(logFilePath, logMessage, (err) => {
    if (err) {
      console.error('Error writing to log file:', err)
    }
  })
}

console.log(`Starting log writer. Appending to ${logFilePath}`)
setInterval(writeLog, 2000)
