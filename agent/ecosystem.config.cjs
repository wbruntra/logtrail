module.exports = {
  apps: [
    {
      name: 'logtrail-agent',
      script: 'logtrail-agent.ts',
      interpreter: 'bun',
      cwd: __dirname,
      // Restart when the config changes
      watch: ['agent.config.yaml'],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: { NODE_ENV: 'production' },
    },
  ],
}
