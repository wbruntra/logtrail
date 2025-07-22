const fs = require('fs')
const path = require('path')


const logFilePath1 = path.join(__dirname, '../test/log.txt')
const logFilePath2 = path.join(__dirname, '../test/log2.txt')


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
  writeLog(logFilePath1, 'Main');
  writeLog(logFilePath2, 'Secondary');
}, 2000);
