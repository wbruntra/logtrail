const fs = require('fs')
const path = require('path')

const configPath = path.join(__dirname, '../logtrail.config.yaml')

function getLogConfig() {
  try {
    const file = fs.readFileSync(configPath, 'utf8')
    const config = Bun.YAML.parse(file)
    return config.logs || []
  } catch (err) {
    console.error('Error reading config:', err)
    return []
  }
}

module.exports = { getLogConfig }
