const EventEmitter = require('events')
const tailStream = require('tail-stream')
const { exec } = require('child_process')
const { promisify } = require('util')

const execAsync = promisify(exec)

class FileWatcher extends EventEmitter {
  constructor(filePath) {
    super()
    this.filePath = filePath
    this.currentLineNumber = 0
    this.initializeLineNumber()
    this.startTail()
  }

  async initializeLineNumber() {
    try {
      // Get current line count to know where we're starting
      const { stdout } = await execAsync(`wc -l < "${this.filePath}"`)
      this.currentLineNumber = parseInt(stdout.trim(), 10)
    } catch (error) {
      console.error('Error getting initial line count:', error)
      this.currentLineNumber = 0
    }
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
      const lines = data.toString().split('\n').filter(line => line.trim() !== '')
      lines.forEach(line => {
        this.currentLineNumber++
        this.emit('data', {
          lineNumber: this.currentLineNumber,
          content: line
        })
      })
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
