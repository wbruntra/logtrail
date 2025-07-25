const fs = require('fs')
const path = require('path')


const logFilePath1 = path.join(__dirname, '../test/log.txt')
const logFilePath2 = path.join(__dirname, '../test/log2.txt')

// rotating array of logs to make sure we are writing
const logMessages = [
  'Log message 1',
  'Log message 2',
  'Log message 3',
]

let logIndexes = {
  main: 0,
  secondary: 0,
}

function writeLog(filePath, label) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${label} test\n`;
  fs.appendFile(filePath, logMessage, (err) => {
    if (err) {
      console.error(`Error writing to ${filePath}:`, err);
    }
  });
}

console.log(`Starting log writer. Appending to both ${logFilePath1} and ${logFilePath2}`);
setInterval(() => {
  writeLog(logFilePath1, `Main ${logIndexes.main++}`);
  writeLog(logFilePath2, `Secondary ${logIndexes.secondary++}`);
}, 2000);
