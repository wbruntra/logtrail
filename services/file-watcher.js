const fs = require('fs')
const EventEmitter = require('events')

class FileWatcher extends EventEmitter {
  constructor(filePath) {
    super()
    this.filePath = filePath
    this.watchFile()
  }

  watchFile() {
    console.log(`Watching for file changes on ${this.filePath}`)
    fs.watchFile(this.filePath, { persistent: true, interval: 1000 }, (curr, prev) => {
      if (curr.mtime > prev.mtime) {
        const stream = fs.createReadStream(this.filePath, {
          start: prev.size,
          end: curr.size,
        })

        stream.on('data', (data) => {
          this.emit('data', data.toString())
        })
      }
    })
  }
}

module.exports = FileWatcher
