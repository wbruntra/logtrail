module.exports = {
  apps: [
    {
      name: 'logtrail-agent',
      script: 'logtrail-agent.js',
      interpreter: 'bun',
      cwd: __dirname,

      // Restart when agent.config.yaml changes
      watch: ['agent.config.yaml'],
      ignore_watch: ['node_modules', '*.log'],

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
