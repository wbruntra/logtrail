const EventEmitter = require('events')
const tailStream = require('tail-stream')

class FileWatcher extends EventEmitter {
  constructor(filePath) {
    super()
    this.filePath = filePath
    this.startTail()
  }

  startTail() {
    console.log(`Watching for file changes on ${this.filePath} (tail-stream)`)
    this.ts = tailStream.createReadStream(this.filePath, {
      beginAt: 'end', // Only new lines
      onMove: 'follow', // Follow file if moved/rotated
      detectTruncate: true,
      endOnError: false,
      encoding: 'utf8',
    })
    this.ts.on('data', (data) => {
      this.emit('data', data.toString())
    })
    this.ts.on('error', (err) => {
      this.emit('error', err)
    })
  }

  close() {
    if (this.ts) this.ts.destroy()
  }
}

module.exports = FileWatcher
