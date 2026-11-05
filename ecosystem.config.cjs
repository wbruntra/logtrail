module.exports = {
  apps: [
    {
      name: 'logtrail-central',
      script: 'hono-app/bin/www.ts',
      interpreter: 'bun',
      cwd: __dirname,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 11411,
      },
      max_memory_restart: '512M',
      log_file: '/home/william/logs/logtrail-central.log',
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
    },
  ],
}
