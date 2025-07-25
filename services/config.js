const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

const configPath = path.join(__dirname, '../logtrail.config.yaml')

function getLogConfig() {
  try {
    const file = fs.readFileSync(configPath, 'utf8')
    const config = yaml.load(file)
    return config.logs || []
  } catch (err) {
    console.error('Error reading config:', err)
    return []
  }
}

module.exports = { getLogConfig }
