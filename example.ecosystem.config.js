module.exports = {
  apps: [
    {
      name: 'logtrail-central',
      script: 'bin/www',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        LOGTRAIL_MODE: 'central',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development',
        LOGTRAIL_MODE: 'central',
        PORT: 3000
      },
      env_staging: {
        NODE_ENV: 'staging',
        LOGTRAIL_MODE: 'central',
        PORT: 3000
      },
      // Central server specific settings
      max_memory_restart: '1G',
      error_file: './logs/central-error.log',
      out_file: './logs/central-out.log',
      log_file: './logs/central-combined.log',
      time: true,
      autorestart: true,
      watch: false,
      ignore_watch: ['node_modules', 'logs', 'client/dist'],
      // Health monitoring
      min_uptime: '10s',
      max_restarts: 10
    },
    {
      name: 'logtrail-agent',
      script: 'bin/www',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        LOGTRAIL_MODE: 'agent',
        PORT: 3001
      },
      env_development: {
        NODE_ENV: 'development',
        LOGTRAIL_MODE: 'agent',
        PORT: 3001
      },
      env_staging: {
        NODE_ENV: 'staging',
        LOGTRAIL_MODE: 'agent',
        PORT: 3001
      },
      // Agent specific settings
      max_memory_restart: '512M',
      error_file: './logs/agent-error.log',
      out_file: './logs/agent-out.log',
      log_file: './logs/agent-combined.log',
      time: true,
      autorestart: true,
      watch: false,
      ignore_watch: ['node_modules', 'logs'],
      // Health monitoring
      min_uptime: '10s',
      max_restarts: 10
    }
  ]
}
