const fs = require('fs');

function tailFile(filePath, lines = 100) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) return reject(err);
      const allLines = data.split(/\r?\n/);
      const tailed = allLines.slice(-lines).join('\n');
      resolve(tailed);
    });
  });
}

module.exports = { tailFile };
