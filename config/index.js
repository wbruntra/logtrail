const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')

class ConfigManager {
  constructor() {
    this.mode = this.getMode()
    this.config = null
    this.loadConfig()
  }

  getMode() {
    return process.env.LOGTRAIL_MODE || 'central'
  }

  isCentralServer() {
    return this.mode === 'central'
  }

  isAgent() {
    return this.mode === 'agent'
  }

  loadConfig() {
    try {
      const configFileName = this.isCentralServer() ? 'central.config.yaml' : 'agent.config.yaml'
      const configPath = path.join(__dirname, configFileName)
      
      if (!fs.existsSync(configPath)) {
        console.warn(`Config file not found: ${configPath}. Using defaults.`)
        this.config = this.getDefaultConfig()
        return
      }

      const configFile = fs.readFileSync(configPath, 'utf8')
      this.config = yaml.load(configFile)
      
      // Substitute environment variables
      this.config = this.substituteEnvVars(this.config)
      
      console.log(`Loaded ${this.mode} configuration from ${configPath}`)
    } catch (error) {
      console.error(`Error loading config: ${error.message}`)
      this.config = this.getDefaultConfig()
    }
  }

  substituteEnvVars(obj) {
    if (typeof obj === 'string') {
      // Replace ${VAR_NAME} or ${VAR_NAME:-default} patterns
      return obj.replace(/\$\{([^}]+)\}/g, (match, varExpr) => {
        const [varName, defaultValue] = varExpr.split(':-')
        return process.env[varName] || defaultValue || match
      })
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.substituteEnvVars(item))
    } else if (obj && typeof obj === 'object') {
      const result = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.substituteEnvVars(value)
      }
      return result
    }
    return obj
  }

  getDefaultConfig() {
    if (this.isCentralServer()) {
      return {
        mode: 'central',
        server: {
          port: parseInt(process.env.PORT) || 3000,
          host: '0.0.0.0'
        },
        security: {
          cookie_secret: process.env.COOKIE_SECRET || 'default-secret-change-me',
          session_max_age: 15552000000
        },
        websocket: {
          enabled: true,
          port: parseInt(process.env.WS_PORT) || 3000,
          path: '/ws',
          ping_interval: 30000
        },
        logs: [],
        remote_logs: [],
        auth: {
          provider: 'local',
          require_login: true
        },
        features: {
          enable_search: true,
          enable_history: true,
          enable_real_time: true,
          enable_agent_monitoring: true
        }
      }
    } else {
      return {
        mode: 'agent',
        agent: {
          id: process.env.AGENT_ID || 'agent-unknown',
          name: process.env.AGENT_NAME || 'Unknown Agent',
          description: process.env.AGENT_DESCRIPTION || 'Agent without description',
          type: process.env.SYSTEM_TYPE || 'generic',
          environment: process.env.ENVIRONMENT || 'production'
        },
        central_server: {
          url: process.env.CENTRAL_SERVER_URL || 'ws://localhost:3000',
          api_key: process.env.AGENT_API_KEY || 'default-key-change-me',
          reconnect_interval: 5000,
          ping_interval: 30000
        },
        server: {
          port: parseInt(process.env.PORT) || 3001,
          host: '127.0.0.1'
        },
        logs: [],
        features: {
          enable_search: true,
          enable_history: true,
          enable_real_time: true
        }
      }
    }
  }

  get(path) {
    const keys = path.split('.')
    let current = this.config
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key]
      } else {
        return undefined
      }
    }
    
    return current
  }

  getServer() {
    return this.get('server') || {}
  }

  getLogs() {
    return this.get('logs') || []
  }

  getAgent() {
    return this.get('agent') || {}
  }

  getCentralServer() {
    return this.get('central_server') || {}
  }

  getWebSocket() {
    return this.get('websocket') || {}
  }

  getSecurity() {
    return this.get('security') || {}
  }

  getFeatures() {
    return this.get('features') || {}
  }

  getPerformance() {
    return this.get('performance') || {}
  }

  // Validate configuration
  validate() {
    const errors = []

    if (this.isCentralServer()) {
      if (!this.get('security.cookie_secret') || this.get('security.cookie_secret') === 'default-secret-change-me') {
        errors.push('Central server requires a secure cookie secret')
      }
    } else {
      if (!this.get('agent.id')) {
        errors.push('Agent requires an ID')
      }
      if (!this.get('central_server.url')) {
        errors.push('Agent requires central server URL')
      }
      if (!this.get('central_server.api_key') || this.get('central_server.api_key') === 'default-key-change-me') {
        errors.push('Agent requires a valid API key')
      }
    }

    return errors
  }

  // Reload configuration
  reload() {
    this.loadConfig()
  }

  // Get all configuration for debugging
  getAll() {
    return { ...this.config }
  }
}

// Export singleton instance
module.exports = new ConfigManager()
